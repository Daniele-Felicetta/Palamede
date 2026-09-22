"""Palamede — dequantizza un GGUF (arch wan, nomi originali) in safetensors/.pth.

Uso:
  python scripts/gguf_to_safetensors.py --src models/x.gguf --dst models/wan/y.safetensors [--dtype f16|bf16|f32]
  python scripts/gguf_to_safetensors.py --src models/x.gguf --dst models/wan/y.pth --dtype bf16

Tutti i tensori vengono dequantizzati (K-quant inclusi) con la libreria gguf
ufficiale e salvati con nomi/forme ORIGINALI. Serve per usare in Palamede i
pesi quantizzati in proprio senza runtime GGUF.
"""
import argparse
import sys

import gguf
import numpy as np
import torch
from safetensors.torch import save_file

DTYPE = {"f16": torch.float16, "bf16": torch.bfloat16, "f32": torch.float32}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--dtype", choices=["f16", "bf16", "f32"], default="f16")
    ap.add_argument("--ref", default=None,
                    help="safetensors/.pth originale: se una forma differisce "
                         "a parita' di elementi, viene ripristinata (sicurezza)")
    args = ap.parse_args()

    ref_shapes = {}
    if args.ref:
        if args.ref.endswith((".pt", ".pth", ".bin", ".ckpt")):
            rsd = torch.load(args.ref, map_location="cpu", weights_only=True)
        else:
            from safetensors.torch import load_file as _lf
            rsd = _lf(args.ref)
        for k, v in rsd.items():
            ref_shapes[k] = tuple(int(x) for x in v.shape)
        del rsd

    reader = gguf.GGUFReader(args.src)
    print(f"tensori: {len(reader.tensors)}", flush=True)
    out = {}
    for t in reader.tensors:
        # il reader gguf restituisce gia' l'orientamento originale
        arr = np.ascontiguousarray(gguf.quants.dequantize(t.data, t.tensor_type))
        if t.name in ref_shapes and tuple(arr.shape) != ref_shapes[t.name]:
            if int(np.prod(arr.shape)) != int(np.prod(ref_shapes[t.name])):
                raise RuntimeError(f"numel diverso per {t.name}")
            arr = arr.reshape(ref_shapes[t.name])
        out[t.name] = torch.from_numpy(arr).to(DTYPE[args.dtype])
        if len(out) % 200 == 0:
            print(f"  …{len(out)}/{len(reader.tensors)}", flush=True)
    if args.dst.endswith(".pth"):
        torch.save(out, args.dst)
    else:
        save_file(out, args.dst)
    print(f"scritto: {args.dst} ({len(out)} tensori, {args.dtype})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
