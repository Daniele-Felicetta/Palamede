"""Jarvis ascoltami: wav 16kHz -> testo (Parakeet locale, offline).
Uso: tools/jarvis-venv/Scripts/python.exe jarvis-livekit/stt_file.py mio_audio.wav"""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import sys
from transformers import pipeline

p = pipeline("automatic-speech-recognition", model="models/Jarvis/Parakeet")
print(p(sys.argv[1])["text"])
