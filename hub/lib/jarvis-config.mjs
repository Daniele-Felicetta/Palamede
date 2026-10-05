// Path pesi Jarvis (mirror di jarvis-livekit/config.py MODELS) + porte.
// Unico punto di verità per hub/lib/jarvis.mjs (niente duplicazione).

export const JARVIS_FILES = {
  brain: 'models/Jarvis/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  stt_nemo: 'models/Jarvis/Parakeet/parakeet-tdt-0.6b-v3.nemo',
  stt_gguf: 'models/Jarvis/Parakeet/parakeet-tdt-0.6b-v3.q8_0.gguf',
  tts_t3: 'models/Jarvis/chatterbox-multilingual-v2/t3_23lang.safetensors',
  tts_s3gen: 'models/Jarvis/chatterbox-multilingual-v2/s3gen.pt',
  tts_ve: 'models/Jarvis/chatterbox-multilingual-v2/ve.pt',
  tts_v3dir: 'models/Jarvis/chatterbox-multilingual-v3',
  tts_fallback: 'models/Jarvis/kokoro/kokoro-v1_0.pth',
  wake: 'models/Jarvis/livekit-wakeword/output/ehi_jarvis/ehi_jarvis.onnx',
}

export const JARVIS_PORTS = {
  supervisor: 8100, stt: 8101, llm: 8121, tts: 8103, wake: 8104, livekit: 7880, hub: 4600,
}
