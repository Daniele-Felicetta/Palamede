import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "reference" / "wan2.1"))
from wan.modules.t5 import T5EncoderModel

PROMPT = "A cat walking in a garden"

t0 = time.perf_counter()
te = T5EncoderModel(
    text_len=512, dtype=torch.bfloat16, device=torch.device("cpu"),
    checkpoint_path=str(ROOT / "models" / "wan2.1-t2v-1.3b" / "models_t5_umt5-xxl-enc-bf16.pth"),
    tokenizer_path=str(ROOT / "models" / "wan2.1-t2v-1.3b" / "google" / "umt5-xxl"),
)
print(f"T5-TORCH-LOADED +{time.perf_counter()-t0:.0f}s", flush=True)
ctx = te([PROMPT], torch.device("cpu"))[0].float().numpy()
print(f"torch ctx: {ctx.shape}", flush=True)

body = json.dumps({"content": PROMPT}).encode()
req = urllib.request.Request("http://127.0.0.1:8130/embedding", data=body,
                             headers={"Content-Type": "application/json"})
j = json.loads(urllib.request.urlopen(req, timeout=600).read().decode())
ll = np.array(j[0]["embedding"], dtype=np.float64)
print(f"llama emb: {ll.shape}", flush=True)

n = min(len(ctx), len(ll))
a, b = ctx[:n].reshape(n, -1), ll[:n].reshape(n, -1)
an = a / (np.linalg.norm(a, axis=-1, keepdims=True) + 1e-12)
bn = b / (np.linalg.norm(b, axis=-1, keepdims=True) + 1e-12)
m = an @ bn.T
np.set_printoptions(precision=2, suppress=True, linewidth=200)
print("cos matrix torch-rows x llama-cols:", flush=True)
print(m, flush=True)
print(f"diag={np.diag(m).round(3).tolist()} ci={m.argmax(1).tolist()}", flush=True)
