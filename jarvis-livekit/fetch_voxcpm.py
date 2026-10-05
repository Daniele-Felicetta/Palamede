"""Scarica snapshot VoxCPM2 ufficiale (openbmb/VoxCPM2) in data/voxcpm/VoxCPM2. Skip se presente."""
from huggingface_hub import snapshot_download
from pathlib import Path

dest = Path("models/Jarvis/livekit-wakeword/data/voxcpm/VoxCPM2")
if dest.is_dir() and any(dest.iterdir()):
    print("VoxCPM2 gia presente in", dest)
else:
    dest.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id="openbmb/VoxCPM2", local_dir=str(dest))
    print("VoxCPM2 scaricato in", dest)
