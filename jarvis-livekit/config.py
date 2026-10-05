# Jarvis — voice assistant locale per Palamede (STT-LLM-TTS via LiveKit self-hosted).
# F0/F1: push-to-talk + tool Palamede. F2: wake ehi_jarvis. F3: WebRTC full.
# Tutto su 127.0.0.1, zero cloud. Pesi in models/Jarvis (gitignored).

JARVIS_PORTS = {
    "supervisor": 8100,   # questo supervisor (status + token mint in F3)
    "stt": 8101,          # Parakeet wrapper OpenAI-compat
    "llm": 8121,          # riusa tools/llama-cpp/llama-server.exe (hub /api/chat)
    "tts": 8103,          # Chatterbox-Multilingual-V3 / Kokoro fallback
    "wake": 8104,         # livekit-wakeword ehi_jarvis
    "livekit": 7880,      # livekit-server --dev (Go, F3)
    "hub": 4600,          # Palamede hub (tool: image/kb/3d)
}

# Modelli (path relativi alla root Palamede)
MODELS = {
    "brain": "models/Jarvis/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",  # 6.7GB QAT
    "stt_nemo": "models/Jarvis/Parakeet/parakeet-tdt-0.6b-v3.nemo",
    "stt_gguf": "models/Jarvis/Parakeet/parakeet-tdt-0.6b-v3.q8_0.gguf",
    "tts_dir_v2": "models/Jarvis/chatterbox-multilingual-v2",  # V2 verificato (t3_23lang+s3gen.pt+ve.pt)
    "tts_dir_v3": "models/Jarvis/chatterbox-multilingual-v3",  # V3 in attesa di package che lo supporti
    "tts_fallback": "models/Jarvis/kokoro/kokoro-v1_0.pth",  # + voices/if_sara.pt
    "wake": "models/Jarvis/livekit-wakeword/output/ehi_jarvis/ehi_jarvis.onnx",  # da F2
}

# Tool allowlist verso il hub (mai shell libera)
TOOLS = [
    "palamede.image",   # POST /api/image {prompt, model}
    "palamede.kb",      # POST /api/kb/retrieve {query}
    "palamede.3d",      # POST /api/3d/generate {image}
    "sys.time",         # ora locale
    "sys.timer",        # timer locale (notifica Tauri)
    "sys.note",         # salva nota in knowledge/raw/jarvis-memory.md
]

SYSTEM_IT = (
    "Sei Jarvis, assistente vocale locale di Palamede. Rispondi in italiano, "
    "1-2 frasi parlate brevi; i dettagli (immagini, citazioni, file 3D) vanno a schermo. "
    "Per le azioni usa SOLO i tool palamede.* con JSON valido. Mai inventare file o URL."
)
