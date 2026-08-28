"""Loader low-memory condiviso per il transformer gemlite di Bonsai.

Riepilogo del bug che questo modulo risolve: il loader low-mem di
reference/bonsai/scripts/local_backend.py verifica ``missing`` senza filtrare
le chiavi gemlite (``W_q/scales/zeros/...``) che gemlite>=0.6 registra come
``nn.Parameter`` dopo il caricamento per-layer. Quelle chiavi risultano
"mancanti" anche se sono già caricate -> crash all'avvio. Il loader upstream
di ``backend_gpu`` applica il filtro (pipeline_gpu.py righe 227-234); qui lo
riapplichiamo alla versione low-memory, senza toccare reference/.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import torch
from accelerate import init_empty_weights
from diffusers import Flux2Transformer2DModel
from gemlite.core import DType, GemLiteLinearTriton, set_packing_bitwidth

log = logging.getLogger("palamede.gemlite")

# stesse chiavi gemlite riconosciute da backend_gpu.pipeline_gpu
_GEMLITE_LAYER_KEYS = ("W_q", "bias", "scales", "zeros", "metadata", "orig_shape", "meta_scale")


def fixed_low_mem_load_gemlite_transformer(path, *, device: str = "cuda"):
    """Carica il transformer gemlite con picco di RAM basso (meta device)."""
    path = Path(path)
    if not path.is_dir():
        raise FileNotFoundError(f"Gemlite transformer artifact not found at {path}")
    state_path = path / "state_dict.pt"
    config_path = path / "config.json"
    qcfg_path = path / "quantization_config.json"
    autotune_path = path / "gemlite_autotune.json"
    for f in (state_path, config_path, qcfg_path, autotune_path):
        if not f.is_file():
            raise FileNotFoundError(f"Gemlite transformer missing {f.name} at {f}")

    with config_path.open() as fh:
        cfg = json.load(fh)
    with qcfg_path.open() as fh:
        qcfg = json.load(fh)
    bits = int(qcfg.get("bits", 1))
    group_size = int(qcfg.get("group_size", 128))
    packing_bw = int(qcfg.get("packing_bitwidth", 8))

    set_packing_bitwidth(packing_bw)
    GemLiteLinearTriton.load_config(str(autotune_path))

    log.info("loading gemlite transformer (LOW-MEM path): bits=%d gs=%d bw=%d",
             bits, group_size, packing_bw)

    with init_empty_weights():
        model = Flux2Transformer2DModel.from_config(cfg)

    state = torch.load(str(state_path), map_location="cpu")

    # cast fp32 -> fp16 in place (i tensori int delle packed weights restano)
    for k in list(state.keys()):
        v = state[k]
        if torch.is_tensor(v) and v.is_floating_point() and v.dtype != torch.float16:
            state[k] = v.to(torch.float16)
            del v

    # import ritardato: il modulo pipeline_gpu deve già essere su sys.path
    from backend_gpu import pipeline_gpu as _pg

    _, remainder = _pg._load_gemlite_layers_from_state(
        model, state,
        bits=bits, group_size=group_size, device=device,
        DType=DType, GemLiteLinearTriton=GemLiteLinearTriton,
    )
    del state

    missing, unexpected = model.load_state_dict(remainder, strict=False, assign=True)
    if unexpected:
        raise RuntimeError(f"unexpected non-gemlite state_dict keys: {unexpected[:8]}")
    # FIX: le chiavi gemlite sono già state caricate per-layer; non contano
    # come "missing". (stesso filtro del loader upstream)
    gemlite_suffixed = lambda ks: [k for k in ks if k.rpartition(".")[2] in _GEMLITE_LAYER_KEYS]
    missing = [k for k in missing if k not in gemlite_suffixed(missing)]
    if missing:
        raise RuntimeError(f"missing non-gemlite state_dict keys: {missing[:8]}")
    del remainder

    _pg._null_gemlite_weights(model, GemLiteLinearTriton)
    return model.to(device).eval()


def apply_fixed_loader(pipeline_gpu_module) -> None:
    """Monkeypatcha ``_load_gemlite_transformer`` sul modulo pipeline_gpu."""
    pipeline_gpu_module._load_gemlite_transformer = fixed_low_mem_load_gemlite_transformer
    log.info("monkeypatched backend_gpu.pipeline_gpu._load_gemlite_transformer (fixed low-mem)")