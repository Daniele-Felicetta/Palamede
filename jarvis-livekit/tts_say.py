"""Jarvis dimmi: testo -> voce (Chatterbox V2 locale, offline).
Uso: tools/jarvis-tts/Scripts/python.exe jarvis-livekit/tts_say.py "Ciao, come va?" [ref.wav]"""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
import sys
from pathlib import Path
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
text = sys.argv[1] if len(sys.argv) > 1 else "Ciao, sono Jarvis."
ref = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "models/Jarvis/TTS-chatterbox-preview/voice.mp3"
# V3 prima (piu naturale), fallback V2 se i pesi futuri rompono la compatibilita.
try:
    sys.path.insert(0, str(ROOT / "jarvis-livekit"))
    from tts_v3 import load_v3
    model = load_v3(ROOT, ROOT / "models/Jarvis/chatterbox-multilingual-v3",
                    ROOT / "models/Jarvis/chatterbox-multilingual-v2", device="cuda")
except Exception as e:
    print("V3 non caricato, fallback V2:", e)
    model = ChatterboxMultilingualTTS.from_local(ROOT / "models/Jarvis/chatterbox-multilingual-v2", device="cuda")
# espressivita: exaggeration alto + cfg basso = piu naturale e teatrale (tips ufficiali).
# Override via env: JARVIS_EXAG, JARVIS_CFG.
exag = float(os.environ.get("JARVIS_EXAG", "0.7"))
cfg = float(os.environ.get("JARVIS_CFG", "0.3"))
wav = model.generate(text, audio_prompt_path=str(ref) if ref.exists() else None,
                     language_id="it", exaggeration=exag, cfg_weight=cfg)
out = ROOT / "outputs" / "jarvis_reply.wav"
sf.write(str(out), wav.squeeze().cpu().numpy(), model.sr)
print("OK", out)
