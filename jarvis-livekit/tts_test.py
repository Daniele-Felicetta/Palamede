"""Prova Mouth Chatterbox Multilingual V2 (pesi locali, offline)."""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
from pathlib import Path
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
model = ChatterboxMultilingualTTS.from_local(ROOT / "models" / "Jarvis" / "chatterbox-multilingual-v2", device="cuda")
ref = ROOT / "models" / "Jarvis" / "TTS-chatterbox-preview" / "voice.mp3"
text = "Ciao, sono Jarvis. Il sistema vocale locale è attivo e parlo italiano."
wav = model.generate(text, audio_prompt_path=str(ref) if ref.exists() else None, language_id="it")
out = ROOT / "outputs" / "jarvis_tts_test.wav"
out.parent.mkdir(exist_ok=True)
sf.write(str(out), wav.squeeze().cpu().numpy(), model.sr)
print("OK", out, wav.shape, model.sr)
