"""Prova V3: carica i pesi t3_mtl23ls_v3/s3gen_v3/ve locali nelle classi 0.1.7 (stesso backbone 0.5B)."""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
from pathlib import Path
import torch
from safetensors.torch import load_file as load_safetensors
from chatterbox.models.t3 import T3
from chatterbox.models.t3.modules.t3_config import T3Config
from chatterbox.models.s3gen import S3Gen
from chatterbox.models.voice_encoder import VoiceEncoder
from chatterbox.mtl_tts import MTLTokenizer, Conditionals, ChatterboxMultilingualTTS
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
V3 = ROOT / "models/Jarvis/chatterbox-multilingual-v3"
V2 = ROOT / "models/Jarvis/chatterbox-multilingual-v2"
device = "cuda"

ve = VoiceEncoder()
ve.load_state_dict(load_safetensors(V3 / "ve.safetensors"))
ve.to(device).eval()

t3 = T3(T3Config.multilingual())
t3_state = load_safetensors(V3 / "t3_mtl23ls_v3.safetensors")
if "model" in t3_state.keys():
    t3_state = t3_state["model"][0]
t3.load_state_dict(t3_state)
t3.to(device).eval()

s3gen = S3Gen()
s3gen.load_state_dict(torch.load(V3 / "s3gen_v3.pt", map_location=None, weights_only=True), strict=False)
s3gen.to(device).eval()

tokenizer = MTLTokenizer(str(V2 / "grapheme_mtl_merged_expanded_v1.json"))
conds = Conditionals.load(V2 / "conds.pt").to(device) if (V2 / "conds.pt").exists() else None

model = ChatterboxMultilingualTTS(t3, s3gen, ve, tokenizer, device, conds=conds)
ref = ROOT / "models/Jarvis/TTS-chatterbox-preview/voice.mp3"
wav = model.generate("Ciao, sono Jarvis. Questa e la nuova voce, piu calda e naturale.",
                     audio_prompt_path=str(ref), language_id="it",
                     exaggeration=0.7, cfg_weight=0.3)
out = ROOT / "outputs" / "jarvis_v3_test.wav"
sf.write(str(out), wav.squeeze().cpu().numpy(), model.sr)
print("V3 OK", out, wav.shape)
