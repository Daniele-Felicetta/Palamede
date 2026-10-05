"""Jarvis agent worker (LiveKit Agents, STT-LLM-TTS locale).

F0/F1: definisce i 6 tool allowlist verso il hub Palamede :4600 (stessi
contratti di /api/image, /api/kb/retrieve, /api/3d/generate). Il wiring
LiveKit AgentSession(STT Parakeet, LLM Gemma via llama-server, TTS
Chatterbox-V3/Kokoro, VAD Silero, wake-gate ehi_jarvis) arriva in F3 —
qui solo logica tool pura e testabile senza GPU/audio.

Uso:
  python jarvis-livekit/agent.py tools          # lista tool
  python jarvis-livekit/agent.py call sys.time  # prova un tool (hub deve girare)
"""
import json
import sys
import urllib.request
from datetime import datetime

HUB = "http://127.0.0.1:4600"


def _post(path, payload, timeout=120):
    req = urllib.request.Request(
        HUB + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def tool_image(prompt, model="bonsai"):
    """Genera un'immagine via Palamede. model: bonsai|zimage|klein|qwenimage."""
    return _post("/api/image", {"model": model, "prompt": prompt,
                                "steps": 4, "seed": -1, "width": 512, "height": 512, "count": 1},
                 timeout=900)


def tool_kb(query, topK=5):
    """Interroga le fonti RAG dell'utente con citazioni."""
    return _post("/api/kb/retrieve", {"query": query, "topK": topK}, timeout=120)


def tool_3d(image_data_url):
    """Genera un asset 3D da un'immagine dataUrl (server 3D deve essere acceso)."""
    return _post("/api/3d/generate", {"image": image_data_url}, timeout=900)


def tool_time():
    return {"time": datetime.now().isoformat(timespec="seconds")}


def tool_timer(seconds):
    return {"timer_s": int(seconds), "status": "scheduled (notifica Tauri in F3)"}


def tool_note(text):
    with open("knowledge/raw/jarvis-memory.md", "a", encoding="utf-8") as f:
        f.write(f"\n- {datetime.now().date()} {text}\n")
    return {"saved": True}


TOOLS = {
    "palamede.image": tool_image, "palamede.kb": tool_kb, "palamede.3d": tool_3d,
    "sys.time": tool_time, "sys.timer": tool_timer, "sys.note": tool_note,
}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "tools"
    if cmd == "tools":
        print(json.dumps(sorted(TOOLS), indent=2))
    elif cmd == "call":
        name = sys.argv[2] if len(sys.argv) > 2 else "sys.time"
        fn = TOOLS.get(name)
        if not fn:
            print(json.dumps({"error": "tool sconosciuto"})); sys.exit(2)
        if name == "sys.time":
            print(json.dumps(fn(), indent=2))
        else:
            print(json.dumps({"tool": name, "note": "richiede hub :4600 attivo, wiring LiveKit in F3"}))
    else:
        print(json.dumps({"error": "comando sconosciuto"})); sys.exit(2)
