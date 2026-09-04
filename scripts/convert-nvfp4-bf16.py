"""Palamede — convertitore NVFP4 → BF16 per FLUX.2 klein 9B.

Il file black-forest-labs/FLUX.2-klein-9b-nvfp4 usa la quantizzazione ModelOpt
NVFP4 di BFL. sd.cpp non la supporta; questo script la dequantizza in un
safetensors BF16 standard che sd-server carica normalmente (con i nomi attesi:
prefisso ``model.diffusion_model.``).

Formato NVFP4 (ModelOpt, quant_algo "NVFP4", packing BFL/Comfy):
    <base>.weight          U8       [O, I/2]   due nibble E2M1 per byte
                                               (HIGH nibble = k pari, LOW nibble = k dispari)
    <base>.weight_scale    F8_E4M3  [O, I/16]  scala per blocco di 16 elementi
    <base>.weight_scale_2  F32      scalare    scala globale
    <base>.input_scale     F32      scalare    scala attivazione (ignorata in dequant)
    Dequant:  W[o,i] = E2M1(code[o,i]) * e4m3(weight_scale[o, i//16]) * weight_scale_2

I tensori BF16/F32 non quantizzati (norm scale, embedder, final_layer, ...)
passano invariati; i suffissi ``*.weight_scale*`` / ``*.input_scale`` vengono
eliminati.

Uso:
    python scripts/convert-nvfp4-bf16.py <input.safetensors> <output.safetensors>
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

# E2M1 (NVIDIA FP4, bias esponente 1): nibble -> float.
#   e=0: 0 / 0.5 · e=1: 1.0 / 1.5 · e=2: 2.0 / 3.0 · e=3: 4.0 / 6.0  (+ segno)
_E2M1 = torch.tensor(
    [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0,
     -0.0, -0.5, -1.0, -1.5, -2.0, -3.0, -4.0, -6.0],
    dtype=torch.float32,
)

QUANT_SUFFIXES = (".weight_scale", ".weight_scale_2", ".input_scale")


def quantized_bases(keys: set[str]) -> set[str]:
    """Nomi base dei linear quantizzati: hanno ``.weight_scale_2``."""
    return {k[: -len(".weight_scale_2")] for k in keys if k.endswith(".weight_scale_2")}


def dequant_weight(w8: torch.Tensor, ws: torch.Tensor, ws2: torch.Tensor) -> torch.Tensor:
    """Dequantizzazione NVFP4 ModelOpt -> BF16. w8 U8 [O,I/2], ws F8_E4M3 [O,I/16], ws2 F32.

    Packing BFL/Comfy: HIGH nibble = k pari, LOW nibble = k dispari.
    """
    O, half = w8.shape
    I = half * 2
    lo = (w8 & 0x0F).to(torch.long)      # low nibble = k dispari
    hi = (w8 >> 4).to(torch.long)        # high nibble = k pari
    codes = torch.empty(O, I, dtype=torch.long)
    codes[:, 0::2] = hi
    codes[:, 1::2] = lo
    vals = _E2M1[codes]                                # [O, I]
    scale = ws.float()                                 # [O, I/16]
    vals = vals.reshape(O, I // 16, 16)
    vals = vals * scale.unsqueeze(-1)
    vals = vals.reshape(O, I) * float(ws2)
    return vals.to(torch.bfloat16)


def main(src: str, dst: str) -> None:
    t0 = time.perf_counter()
    with safe_open(src, framework="pt", device="cpu") as f:
        keys = set(f.keys())
        bases = quantized_bases(keys)
        print(f"[convert] tensori: {len(keys)} | linear quantizzati: {len(bases)}")

        out: dict[str, torch.Tensor] = {}
        skip = set()
        for base in bases:
            for suffix in (".weight", ".weight_scale", ".weight_scale_2", ".input_scale"):
                skip.add(base + suffix)
            w = f.get_tensor(base + ".weight")
            ws = f.get_tensor(base + ".weight_scale")
            ws2 = f.get_tensor(base + ".weight_scale_2")
            out["model.diffusion_model." + base + ".weight"] = dequant_weight(w, ws, ws2)
            del w, ws, ws2

        passthrough = 0
        for k in sorted(keys):
            if k == "__metadata__":
                continue
            if k in skip:
                continue
            out["model.diffusion_model." + k] = f.get_tensor(k)
            passthrough += 1

    save_file(out, dst, metadata={"format": "pt", "stage": "nvfp4-dequant->bf16"})
    size = Path(dst).stat().st_size / (1024**3)
    print(f"[convert] {len(bases)} dequant + {passthrough} pass-through "
          f"-> {dst} ({size:.2f} GB) in {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])