"""Palamede — backend HTTP per Bonsai Image (ternary gemlite).

Wrapper FastAPI attorno a ``reference/bonsai/scripts/local_backend:app`` con
un fix al loader low-memory del transformer gemlite.

Perche' serve: il loader low-mem originale in ``local_backend.py`` verifica
``missing`` SENZA filtrare le chiavi gemlite (``W_q/scales/zeros/...``) che
gemlite>=0.6 registra come ``nn.Parameter`` sui moduli dopo il caricamento
per-layer. Quelle chiavi risultano quindi "mancanti" anche se sono gia'
caricate -> ``RuntimeError: missing non-gemlite state_dict keys``. Il loader
upstream di ``backend_gpu`` applica il filtro (``pipeline_gpu.py`` righe
227-234); qui lo riapplichiamo alla versione low-memory.

Avvio (vedi anche scripts/start-bonsai.ps1):
    $env:MFLUX_STUDIO_GPU_* = ...  # path ai componenti in models/
    python -m uvicorn backends.bonsai_backend:app --port 8000
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

import torch
from accelerate import init_empty_weights
from diffusers import Flux2Transformer2DModel
from gemlite.core import DType, GemLiteLinearTriton, set_packing_bitwidth

# reference/bonsai deve stare su sys.path per importare backend_gpu e scripts
_BONSAI_REPO = Path(os.environ.get(
    "BONSAI_REPO",
    str(Path(__file__).resolve().parents[1] / "reference" / "bonsai"),
))
sys.path.insert(0, str(_BONSAI_REPO))

from backend_gpu import pipeline_gpu as _pg  # noqa: E402

log = logging.getLogger("palamede.bonsai")

# stesse chiavi gemlite riconosciute da backend_gpu.pipeline_gpu
_GEMLITE_LAYER_KEYS = ("W_q", "bias", "scales", "zeros", "metadata", "orig_shape", "meta_scale")


def _fixed_low_mem_load_gemlite_transformer(path, *, device: str = _pg.DEFAULT_DEVICE):
    """Loader low-memory (meta device) con filtro chiavi gemlite in ``missing``.

    Copia di ``scripts.local_backend._low_mem_load_gemlite_transformer`` con
    il fix: le chiavi gemlite gia' caricate per-layer non sono "mancanti".
    """
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

    _, remainder = _pg._load_gemlite_layers_from_state(
        model, state,
        bits=bits, group_size=group_size, device=device,
        DType=DType, GemLiteLinearTriton=GemLiteLinearTriton,
    )
    del state

    missing, unexpected = model.load_state_dict(remainder, strict=False, assign=True)
    if unexpected:
        raise RuntimeError(f"unexpected non-gemlite state_dict keys: {unexpected[:8]}")
    # FIX: le chiavi gemlite sono gia' state caricate per-layer; non contano
    # come "missing". (stesso filtro del loader upstream)
    gemlite_suffixed = lambda ks: [k for k in ks if k.rpartition(".")[2] in _GEMLITE_LAYER_KEYS]
    missing = [k for k in missing if k not in gemlite_suffixed(missing)]
    if missing:
        raise RuntimeError(f"missing non-gemlite state_dict keys: {missing[:8]}")
    del remainder

    _pg._null_gemlite_weights(model, GemLiteLinearTriton)
    return model.to(device).eval()


# Il modulo scripts.local_backend al suo import fa gia' il suo monkeypatch
# (con la versione buggata); lo sovrascriviamo subito dopo con la nostra.
import scripts.local_backend as _local_backend  # noqa: E402
_pg._load_gemlite_transformer = _fixed_low_mem_load_gemlite_transformer
log.info("monkeypatched backend_gpu.pipeline_gpu._load_gemlite_transformer (fixed low-mem)")

app = _local_backend.app
__all__ = ["app"]