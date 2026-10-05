"""Loader Chatterbox V3 (pesi locali) sulle classi del package installato."""
from pathlib import Path
import torch
from safetensors.torch import load_file as load_safetensors
from chatterbox.models.t3 import T3
from chatterbox.models.t3.modules.t3_config import T3Config
from chatterbox.models.s3gen import S3Gen
from chatterbox.models.voice_encoder import VoiceEncoder
from chatterbox.mtl_tts import MTLTokenizer, Conditionals, ChatterboxMultilingualTTS


def load_v3(root, v3dir, v2dir, device="cuda"):
    v3, v2 = Path(v3dir), Path(v2dir)
    _ = root
    ve = VoiceEncoder()
    ve.load_state_dict(load_safetensors(v3 / "ve.safetensors"))
    ve.to(device).eval()
    t3 = T3(T3Config.multilingual())
    t3_state = load_safetensors(v3 / "t3_mtl23ls_v3.safetensors")
    if "model" in t3_state.keys():
        t3_state = t3_state["model"][0]
    t3.load_state_dict(t3_state)
    t3.to(device).eval()
    s3gen = S3Gen()
    s3gen.load_state_dict(torch.load(v3 / "s3gen_v3.pt", map_location=None,
                                     weights_only=True), strict=False)
    s3gen.to(device).eval()
    tokenizer = MTLTokenizer(str(v2 / "grapheme_mtl_merged_expanded_v1.json"))
    conds = Conditionals.load(v2 / "conds.pt").to(device) if (v2 / "conds.pt").exists() else None
    return ChatterboxMultilingualTTS(t3, s3gen, ve, tokenizer, device, conds=conds)
