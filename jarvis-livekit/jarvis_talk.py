"""Jarvis talk v2: conversazione continua mani-libere.
- Niente INVIO: sente quando inizi a parlare, capisce quando hai finito.
- Risponde mentre genera: prima frase subito in cassa, resto in coda.
- Tace mentre parli tu (niente auto-ascolto addosso alla sua voce).
Tutto offline. Uso:
  tools/jarvis-venv/Scripts/python.exe jarvis-livekit/jarvis_talk.py
Ctrl+C per uscire.
"""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import json
import queue
import re
import subprocess
import threading
import urllib.request
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
SR = 16000
TRIGGER_S = 0.4    # voce continua per partire
SILENCE_S = 1.5    # silenzio per chiudere il turno
MAX_S = 30
LLM_URL = "http://127.0.0.1:8121/v1/chat/completions"
TTS_PY = str(ROOT / "tools" / "jarvis-tts" / "Scripts" / "python.exe")
TTS_SCRIPT = str(ROOT / "jarvis-livekit" / "tts_say.py")
OUT_DIR = ROOT / "outputs"
HISTORY = [{"role": "system", "content": (
    "Sei Jarvis, maggiordomo digitale ironico e leale, parli italiano. "
    "Rispondi SEMPRE in 1-2 frasi brevissime, tono brillante, zero convenevoli. "
    "Niente markdown, niente elenchi: solo testo da pronunciare a voce. "
    "Se non sai qualcosa, dillo con autoironia in una frase.")}]


def rms(x):
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))


def split_sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text.replace("\n", " "))
    return [s.strip() for s in parts if len(s.strip()) > 1]


def listen_turn(mic, threshold):
    """Aspetta la voce, registra fino al silenzio. Ritorna audio o None."""
    pre, voiced = [], 0.0
    while True:
        chunk, _ = mic.read(int(SR * 0.25))
        pre.append(chunk.copy())
        if len(pre) > 8:
            pre.pop(0)
        if rms(chunk) > threshold:
            voiced += 0.25
            if voiced >= TRIGGER_S:
                break
        else:
            voiced = 0.0
    frames = list(pre)
    silent, started = 0.0, __import__("time").time()
    import time
    started = time.time()
    while True:
        chunk, _ = mic.read(int(SR * 0.25))
        frames.append(chunk.copy())
        if rms(chunk) < threshold:
            silent += 0.25
        else:
            silent = 0.0
        if silent >= SILENCE_S or time.time() - started > MAX_S:
            break
    audio = np.concatenate(frames, axis=0).flatten()
    return audio if len(audio) > SR // 2 else None


def ask_brain(user_text):
    HISTORY.append({"role": "user", "content": user_text})
    body = json.dumps({"messages": HISTORY[-8:], "temperature": 0.7,
                       "stream": False}).encode()
    req = urllib.request.Request(LLM_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        reply = json.loads(r.read().decode())["choices"][0]["message"]["content"]
    HISTORY.append({"role": "assistant", "content": reply})
    return reply.strip()


def speak_streaming(text):
    """Genera frase-per-frase in parallelo e riproduce in ordine: la prima
    frase suona mentre le altre si generano. Latency percepita dimezzata."""
    sentences = split_sentences(text)
    if not sentences:
        return
    q = queue.Queue()
    stop = threading.Event()

    def producer():
        for i, s in enumerate(sentences):
            if stop.is_set():
                break
            wav_path = OUT_DIR / f"_jarvis_{i}.wav"
            try:
                subprocess.run([TTS_PY, TTS_SCRIPT, s], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                # tts_say scrive jarvis_reply.wav: lo sposto in coda ordinata
                src = OUT_DIR / "jarvis_reply.wav"
                wav_path.write_bytes(src.read_bytes())
                q.put((i, wav_path))
            except Exception as e:
                print(f"(frase {i + 1} saltata: {e})")
        q.put(None)

    threading.Thread(target=producer, daemon=True).start()
    pending, nxt = {}, 0
    while True:
        item = q.get()
        if item is None:
            break
        i, wav_path = item
        pending[i] = wav_path
        while nxt in pending:
            p = pending.pop(nxt)
            try:
                data, sr = sf.read(str(p), dtype="float32")
                sd.play(data, sr)
                sd.wait()
            finally:
                try:
                    p.unlink()
                except OSError:
                    pass
            nxt += 1


def main():
    print("=== Jarvis: calibro il silenzio, resta zitto... ===")
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32") as mic:
        noise, _ = mic.read(SR // 2)
    threshold = max(rms(noise) * 2.5, 0.008)
    print(f"soglia: {threshold:.4f}")
    print("Carico Parakeet...")
    from transformers import pipeline
    stt = pipeline("automatic-speech-recognition", model="models/Jarvis/Parakeet")
    print("=== Parla pure, ti ascolto. (Ctrl+C per uscire) ===")
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32") as mic:
        while True:
            try:
                audio = listen_turn(mic, threshold)
            except (KeyboardInterrupt, EOFError):
                break
            if audio is None:
                continue
            tmp = str(OUT_DIR / "_mic.wav")
            sf.write(tmp, audio, SR)
            try:
                heard = stt(tmp)["text"].strip()
            except Exception as e:
                print("STT errore:", e)
                continue
            if not heard:
                continue
            print("TU:", heard)
            try:
                reply = ask_brain(heard)
            except Exception as e:
                print("Brain giu (:8121)?", e)
                continue
            print("JARVIS:", reply)
            try:
                speak_streaming(reply)
            except Exception as e:
                print("TTS errore:", e)
            print("--- ti ascolto ---")


if __name__ == "__main__":
    main()
