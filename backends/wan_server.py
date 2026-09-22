"""Palamede — Wan2.1 text-to-video server (:8126).

Genera brevi clip MP4 dal modello Wan2.1-T2V-1.3B (pesi ufficiali, la parte DiT
è la nostra dequantizzazione Q4_K_M riespansa in F16). Motore: codice ufficiale
Wan-Video/Wan2.1 in `reference/wan2.1` (sola lettura) + fallback SDPA nostro
(`backends/wan_attention.py`, niente flash_attn) + ffmpeg di sistema per l'mp4.

Text encoder intercambiabile:
- `torch` (default): T5EncoderModel ufficiale su CPU (t5_cpu), ~11 GB RAM;
- `llama`: contesto dal llama-server T5-Q4_K_M (:8130, `arch=t5encoder`
  quantizzato in proprio, solo codice ufficiale llama.cpp), ~3 GB.

POST /generate {prompt, encoder, width, height, frames, steps, seed} → mp4
salvato in outputs/videos/ (+ PNG di anteprima). Un modello alla volta: le
generazioni sono serializzate da un lock (come il modello server).
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger("palamede.wan")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

ROOT = Path(__file__).resolve().parents[1]
WAN_REPO = ROOT / "reference" / "wan2.1"
MODEL_DIR = Path(os.environ.get(
    "PALAMEDE_WAN_DIR", str(ROOT / "models" / "wan2.1-t2v-1.3b")))
VIDEOS = ROOT / "outputs" / "videos"
FFMPEG = os.environ.get("PALAMEDE_FFMPEG") or shutil.which("ffmpeg")
LLAMA_T5 = os.environ.get("PALAMEDE_LLAMA_T5", "http://127.0.0.1:8130")
WAN_PORT = int(os.environ.get("PALAMEDE_WAN_PORT", "8126"))

if str(WAN_REPO) not in sys.path:
    sys.path.insert(0, str(WAN_REPO))
if str(ROOT / "backends") not in sys.path:
    sys.path.insert(0, str(ROOT / "backends"))

import torch  # noqa: E402

from wan_attention import apply_sdpa_fallback  # noqa: E402
from wan.configs import WAN_CONFIGS  # noqa: E402
from wan.text2video import WanT2V  # noqa: E402

apply_sdpa_fallback()

TEXT_LEN = 512


class WanManager:
    """Caricamento lazy di DiT+VAE su GPU e generazione serializzata."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wan: WanT2V | None = None
        self._loading = False
        self.load_time_s: float | None = None

    @property
    def loading(self) -> bool:
        return self._loading

    @property
    def ready(self) -> bool:
        return self._wan is not None

    def status(self) -> dict:
        return {
            "ready": self.ready,
            "loading": self.loading,
            "load_time_s": round(self.load_time_s, 1) if self.load_time_s else None,
            "model_dir": str(MODEL_DIR),
        }

    def _ensure_loaded(self) -> None:
        if self._wan is not None:
            return
        if self._loading:
            deadline = time.time() + 600.0
            while time.time() < deadline:
                time.sleep(1.0)
                if self._wan is not None:
                    return
                if not self._loading:
                    break
            if self._wan is not None:
                return
            if self._loading:
                raise RuntimeError("Wan sta ancora caricando; riprova tra poco")
        self._loading = True
        t0 = time.perf_counter()
        try:
            for f in ("diffusion_pytorch_model.safetensors",
                      "models_t5_umt5-xxl-enc-bf16.pth",
                      "Wan2.1_VAE.pth", "config.json"):
                if not (MODEL_DIR / f).exists():
                    raise FileNotFoundError(
                        f"manca {MODEL_DIR / f} — vedi scripts/wan_setup (dequant dai GGUF)")
            log.info("caricamento Wan2.1-T2V-1.3B da %s ...", MODEL_DIR)
            self._wan = WanT2V(
                config=WAN_CONFIGS["t2v-1.3B"], checkpoint_dir=str(MODEL_DIR),
                device_id=0, t5_cpu=True)
            self.load_time_s = time.perf_counter() - t0
            log.info("Wan pronto in %.1fs", self.load_time_s)
        except Exception:
            self._loading = False
            raise
        else:
            self._loading = False

    def preload(self) -> None:
        if self._wan is not None or self._loading:
            return
        threading.Thread(target=self._preload_worker, daemon=True).start()

    def _preload_worker(self) -> None:
        try:
            self._ensure_loaded()
        except Exception:
            self._loading = False
            log.exception("preload Wan fallito (ricarico alla prima generazione)")

    # ── encoder ──
    def _context_torch(self, wan: WanT2V, prompt: str, neg: str):
        te = wan.text_encoder
        ctx = te([prompt], wan.device)[0]
        null = te([neg], wan.device)[0] if neg else te([wan.config.sample_neg_prompt], wan.device)[0]
        return [ctx], [null]

    def _context_llama(self, wan: WanT2V, prompt: str, neg: str):
        if not neg:
            neg = wan.config.sample_neg_prompt

        def emb(text: str) -> torch.Tensor:
            body = json.dumps({"content": text}).encode()
            req = urllib.request.Request(
                LLAMA_T5 + "/embedding", data=body,
                headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=600) as r:
                    vecs = json.loads(r.read().decode())[0]["embedding"]
            except Exception as e:
                raise RuntimeError(f"llama-server T5 ({LLAMA_T5}): {e}") from e
            t = torch.tensor(vecs, dtype=torch.float32, device=wan.device)
            return t.unsqueeze(0)  # [1, L, 4096]

        return [emb(prompt)], [emb(neg)]

    # ── generazione ──
    def generate(self, prompt: str, encoder: str = "torch", width: int = 256,
                 height: int = 144, frames: int = 9, steps: int = 4,
                 seed: int = -1, guide: float = 6.0, shift: float = 8.0) -> dict:
        prompt = (prompt or "").strip()
        if not prompt:
            raise ValueError("prompt vuoto")
        if encoder not in ("torch", "llama"):
            raise ValueError("encoder: 'torch' o 'llama'")
        width = max(64, (int(width) // 16) * 16)
        height = max(64, (int(height) // 16) * 16)
        frames = int(frames)
        if (frames - 1) % 4 != 0 or not 5 <= frames <= 81:
            raise ValueError("frames: 4n+1 tra 5 e 81 (es. 9, 17, 33)")
        steps = max(1, min(int(steps), 50))
        rng = random.SystemRandom()
        eff = seed if seed != -1 else rng.randint(0, 2**31 - 1)

        with self._lock:
            self._ensure_loaded()
            wan = self._wan
            assert wan is not None

            # contesto con l'encoder scelto (stessa forma [1, L, 4096])
            if encoder == "llama":
                arg_c, arg_null = self._context_llama(wan, prompt, "")
            else:
                arg_c, arg_null = self._context_torch(wan, prompt, "")
            log.info("context: %s encoder=%s", [tuple(c.shape) for c in arg_c], encoder)

            t0 = time.perf_counter()
            try:
                video = _generate_with_context(
                    wan, arg_c, arg_null, (width, height), frames,
                    steps, guide, shift, eff)
                vid_id, mp4, preview = _save_mp4(video, width, height, frames)
            finally:
                torch.cuda.empty_cache()
            gen_s = time.perf_counter() - t0

        return {
            "id": vid_id,
            "url": f"/api/video/file/{vid_id}.mp4",
            "preview": preview,
            "time_s": round(gen_s, 1),
            "seed": eff,
            "params": {"prompt": prompt, "encoder": encoder, "width": width,
                       "height": height, "frames": frames, "steps": steps},
        }


manager = WanManager()


def _generate_with_context(wan, arg_c, arg_null, size, frames, steps, guide, shift, seed):
    """Replica di WanT2V.generate ma con contesto pre-calcolato (forma identica)."""
    import gc
    import math
    import sys as _sys
    from contextlib import contextmanager
    import torch.cuda.amp as amp
    from tqdm import tqdm
    from wan.utils.fm_solvers_unipc import FlowUniPCMultistepScheduler

    F = frames
    target_shape = (wan.vae.model.z_dim, (F - 1) // wan.vae_stride[0] + 1,
                    size[1] // wan.vae_stride[1], size[0] // wan.vae_stride[2])
    seq_len = math.ceil((target_shape[2] * target_shape[3]) /
                        (wan.patch_size[1] * wan.patch_size[2]) *
                        target_shape[1] / wan.sp_size) * wan.sp_size
    seed_g = torch.Generator(device=wan.device)
    seed_g.manual_seed(seed if seed >= 0 else random.SystemRandom().randint(0, _sys.maxsize))
    noise = [torch.randn(*target_shape, dtype=torch.float32,
                         device=wan.device, generator=seed_g)]

    @contextmanager
    def noop_no_sync():
        yield

    no_sync = getattr(wan.model, "no_sync", noop_no_sync)
    with amp.autocast(dtype=wan.param_dtype), torch.no_grad(), no_sync():
        sched = FlowUniPCMultistepScheduler(
            num_train_timesteps=wan.num_train_timesteps, shift=1,
            use_dynamic_shifting=False)
        sched.set_timesteps(steps, device=wan.device, shift=shift)
        latents = noise
        kw_c = {"context": arg_c, "seq_len": seq_len}
        kw_null = {"context": arg_null, "seq_len": seq_len}
        for _, t in enumerate(tqdm(sched.timesteps)):
            wan.model.to(wan.device)
            ts = torch.stack([t])
            pc = wan.model(latents, t=ts, **kw_c)[0]
            pu = wan.model(latents, t=ts, **kw_null)[0]
            pred = pu + guide * (pc - pu)
            x0 = sched.step(pred.unsqueeze(0), t, latents[0].unsqueeze(0),
                            return_dict=False, generator=seed_g)[0]
            latents = [x0.squeeze(0)]
        x0 = latents
        wan.model.cpu()
        torch.cuda.empty_cache()
        videos = wan.vae.decode(x0)
    del noise, latents
    gc.collect()
    torch.cuda.synchronize()
    return videos[0]


def _save_mp4(video, width: int, height: int, frames: int):
    """Tensore video (C,T,H,W) float 0..1 → mp4 (ffmpeg) + PNG anteprima."""
    import numpy as np
    from PIL import Image

    if FFMPEG is None:
        raise RuntimeError("ffmpeg non trovato (PALAMEDE_FFMPEG o PATH)")
    VIDEOS.mkdir(parents=True, exist_ok=True)
    vid_id = f"{int(time.time()*1000)}-{random.SystemRandom().randint(0, 999999)}"
    arr = (video.float().cpu().numpy() * 255).clip(0, 255).astype("uint8")
    arr = np.transpose(arr, (1, 2, 3, 0))  # (T,H,W,C)
    mp4_path = VIDEOS / f"{vid_id}.mp4"
    cmd = [FFMPEG, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{width}x{height}", "-r", "8", "-i", "-",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
           str(mp4_path)]
    p = subprocess.run(cmd, input=arr.tobytes(), capture_output=True, timeout=600)
    if p.returncode != 0 or not mp4_path.exists():
        raise RuntimeError(f"ffmpeg: {p.stderr.decode()[-500:]}")
    buf = io.BytesIO()
    Image.fromarray(arr[0]).save(buf, format="PNG")
    preview = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return vid_id, mp4_path, preview


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    encoder: str = Field(default="torch")
    width: int = Field(default=256, ge=16)
    height: int = Field(default=144, ge=16)
    frames: int = Field(default=9)
    steps: int = Field(default=4, ge=1, le=50)
    seed: int = Field(default=-1)
    guide: float = Field(default=6.0, ge=1.0, le=15.0)
    shift: float = Field(default=8.0, ge=1.0, le=16.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    manager.preload()
    yield


app = FastAPI(title="Palamede Wan2.1 video server", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/status")
def status() -> dict:
    return manager.status()


@app.post("/generate")
def generate(req: GenerateRequest) -> dict:
    try:
        return manager.generate(req.prompt, req.encoder, req.width, req.height,
                                req.frames, req.steps, req.seed, req.guide, req.shift)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("generazione video fallita")
        raise HTTPException(status_code=500, detail=str(e)) from e


__all__ = ["app", "manager"]
