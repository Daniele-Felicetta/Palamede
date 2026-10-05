"""Supervisor Jarvis F0/F1: avvia/ferma i servizi locali su 127.0.0.1 e espone status.

Uso:
  python jarvis-livekit/supervisor.py status   # JSON readiness (file + porte)
  python jarvis-livekit/supervisor.py stt-test <wav16k>  # placeholder F1

F3 aggiungerà: spawn livekit-server --dev, llama-server, stt/tts/wake subprocess
e POST /api/connection-details (mint token). Per ora nessuna dipendenza extra:
solo stdlib, come hub/lib/*.
"""
import json
import os
import socket
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "jarvis-livekit"))
from config import MODELS, JARVIS_PORTS  # noqa: E402


def port_open(port):
    s = socket.socket()
    s.settimeout(0.3)
    try:
        s.connect(("127.0.0.1", port))
        s.close()
        return True
    except OSError:
        return False


def status():
    import os as _os
    files = {k: _os.path.exists(_os.path.join(ROOT, p)) for k, p in MODELS.items() if not p.endswith('.onnx') or True}
    # per le dir (v2/v3) verifica i file chiave dentro
    v2 = _os.path.join(ROOT, MODELS.get('tts_dir_v2', ''))
    files['tts_v2'] = all(_os.path.exists(_os.path.join(v2, f)) for f in
                          ('t3_23lang.safetensors', 's3gen.pt', 've.pt')) if v2 else False
    ports = {k: port_open(p) for k, p in JARVIS_PORTS.items()}
    return {"files": files, "ports": ports, "ready": files["brain"] and files["stt_gguf"]}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        print(json.dumps(status(), indent=2))
    else:
        print(json.dumps({"error": "comando sconosciuto: %s" % cmd}))
        sys.exit(2)
