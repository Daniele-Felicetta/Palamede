import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "reference" / "wan2.1"))
print("PY-START", flush=True)
t0 = time.perf_counter()

from wan.configs import WAN_CONFIGS
print(f"CFG-OK +{time.perf_counter()-t0:.0f}s", flush=True)

from wan.text2video import WanT2V
print(f"IMPORT-OK +{time.perf_counter()-t0:.0f}s", flush=True)

sys.path.insert(0, str(ROOT / "backends"))
from wan_attention import apply_sdpa_fallback
apply_sdpa_fallback()
print("SDPA-FALLBACK-ON", flush=True)

wan = WanT2V(
    config=WAN_CONFIGS["t2v-1.3B"],
    checkpoint_dir=str(ROOT / "models" / "wan2.1-t2v-1.3b"),
    device_id=0,
    t5_cpu=True,
)
print(f"LOADED +{time.perf_counter()-t0:.0f}s", flush=True)

v = wan.generate(
    "A cat walking in a garden",
    size=(256, 144), frame_num=9, shift=8,
    sampling_steps=4, guide_scale=6, seed=42, offload_model=True,
)
print(f"VIDEO {tuple(v.shape)} {v.dtype} +{time.perf_counter()-t0:.0f}s", flush=True)
