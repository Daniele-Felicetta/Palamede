# Jarvis runtime (tools/jarvis-venv) — registro installazioni del 2026-10-01.
# Policy: solo fonti ufficiali, versioni pinnate. Venv creato offline via `uv venv`
# (interprete CPython 3.11.14 riusato da reference/bonsai in sola lettura).

## Indici
- PyTorch ufficiale: https://download.pytorch.org/whl/cu128
- PyPI ufficiale: https://pypi.org/simple (default uv)

## Pacchetti STT (tools/jarvis-venv)
- torch 2.11.0+cu128 + torchaudio 2.11.0+cu128 (canale PyTorch cu128)
- transformers 5.16.1 (PyPI — serve AutoModelForTDT per Parakeet)
- librosa 0.11.0 + soundfile 0.14.0 + sounddevice 0.5.6 + numpy 2.4.6 (PyPI)

## Pacchetti TTS (tools/jarvis-tts, venv separato: chatterbox-tts 0.1.7 pinna transformers==5.2.0)
- chatterbox-tts 0.1.7 (PyPI, org resemble-ai, MIT, wheel sha256:83782500…)
- transformers 5.2.0 (pinnato da chatterbox) + torch 2.11.0+cu128 (forzato cu128 dopo install)
- resemble-perth 1.0.1 + setuptools==80.9.0 (84 ha rimosso pkg_resources che perth richiede)
- ✅ V2 verificato con pesi locali (t3_mtl23ls_v2 + s3gen.pt + ve.pt, weights_only=True).
  I pesi V3 (t3_mtl23ls_v3/s3gen_v3) restano in attesa di package che li supporti.

## Pesi (locali, nessuna rete)
- Ear: models/Jarvis/Parakeet (.safetensors, CC-BY-4.0 NVIDIA)
- Mouth: models/Jarvis/t3_mtl23ls_v3.safetensors + s3gen_v3 + ve (Chatterbox Multilingual V3, MIT)
- Brain: models/Jarvis/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf via llama-server esistente
