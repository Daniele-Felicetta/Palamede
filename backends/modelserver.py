"""Palamede — modello server unico e dinamico (:8000).

Un solo processo serve entrambi i modelli immagine:

- **bonsai** (gemlite in-process, GpuPipeline)  — caricato su /select
- **zimage** (stable-diffusion.cpp ``sd-server``) — avviato come subprocess
  gestito dal server e terminato al deselezione, così la VRAM si libera.

POST /select {model} scarica il modello corrente e carica quello richiesto;
POST /generate auto-carica se serve. Tutto è serializzato da un lock, quindi
mai due generazioni simultanee (regola di prodotto: un modello alla volta).
"""
from __future__ import annotations

import gc
import logging
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("palamede.modelserver")

ROOT = Path(__file__).resolve().parents[1]
BONSAI_REPO = Path(os.environ.get("BONSAI_REPO", str(ROOT / "reference" / "bonsai")))

# Come fa reference/bonsai/scripts/local_backend.py: TRITON_CACHE_DIR va
# fissato PRIMA dell'import di torch/triton, e la cache gemlite autotune va
# caricata/persistita, altrimenti ogni forma paga la ricompilazione (~60s).
TRITON_CACHE_DIR = BONSAI_REPO / "outputs" / ".triton_cache"
GEMLITE_PERSIST_PATH = BONSAI_REPO / "outputs" / ".gemlite_cache" / "autotune.json"
TRITON_CACHE_DIR.mkdir(parents=True, exist_ok=True)
GEMLITE_PERSIST_PATH.parent.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TRITON_CACHE_DIR", str(TRITON_CACHE_DIR))

sys.path.insert(0, str(BONSAI_REPO))

import torch  # noqa: E402

from backend_gpu import pipeline_gpu as _pg  # noqa: E402
from backend_gpu.pipeline_gpu import GpuPipeline  # noqa: E402
from gemlite.core import GemLiteLinearTriton  # noqa: E402

from backends.gemlite_loader import apply_fixed_loader  # noqa: E402
apply_fixed_loader(_pg)

SD_PORT = int(os.environ.get("PALAMEDE_SD_PORT", "8123"))
SD_EXE = os.environ.get("PALAMEDE_SD_EXE", str(ROOT / "tools" / "sd-cpp" / "sd-server.exe"))
SD_LOG = os.environ.get("PALAMEDE_SD_LOG", str(ROOT / "outputs" / "sd-server.log"))

MODELS = {
    "bonsai": {"name": "Bonsai 4B ternary", "engine": "gemlite (in-process)"},
    "zimage": {"name": "Z-Image Turbo Q4_K_M", "engine": "stable-diffusion.cpp (sd-server)"},
}


class ModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: str | None = None
        self._pipeline: GpuPipeline | None = None
        self._sd: subprocess.Popen | None = None

    # ── stato ──
    def status(self) -> dict:
        sd_alive = self._sd is not None and self._sd.poll() is None
        return {
            "current": self._current,
            "models": [
                {"id": mid, "name": m["name"], "engine": m["engine"],
                 "loaded": self._current == mid}
                for mid, m in MODELS.items()
            ],
            "zimage_process": sd_alive,
        }

    # ── unload ──
    def _unload(self) -> None:
        if self._current == "bonsai" and self._pipeline is not None:
            log.info("unload bonsai: libero VRAM")
            self._pipeline = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        if self._current == "zimage" and self._sd is not None:
            proc = self._sd
            self._sd = None
            log.info("unload zimage: terminazione sd-server (pid=%s)", proc.pid)
            try:
                proc.terminate()
                proc.wait(timeout=15)
            except Exception:
                try:
                    proc.kill()
                    proc.wait(timeout=5)
                except Exception:
                    log.warning("sd-server non terminato pulitamente")
        self._current = None

    # ── load ──
    def _load_bonsai(self) -> None:
        if self._pipeline is None:
            # autotune persistito (forme già provate nei boot precedenti)
            if GEMLITE_PERSIST_PATH.exists():
                try:
                    GemLiteLinearTriton.load_config(str(GEMLITE_PERSIST_PATH), print_error=False)
                    log.info("caricata autotune persistita: %s", GEMLITE_PERSIST_PATH)
                except Exception as e:
                    log.warning("autotune persistita non caricata: %s", e)
            t0 = time.perf_counter()
            pipe = GpuPipeline(backend="bonsai-ternary-gemlite")
            pipe.prewarm()
            self._pipeline = pipe
            log.info("bonsai caricato in %.1fs", time.perf_counter() - t0)
        self._current = "bonsai"

    def _wait_sd_ready(self, timeout: float = 120.0) -> None:
        url = f"http://127.0.0.1:{SD_PORT}/sdapi/v1/options"
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._sd is not None and self._sd.poll() is not None:
                raise RuntimeError("sd-server è uscito durante l'avvio")
            try:
                with urllib.request.urlopen(url, timeout=3):
                    return
            except Exception:
                time.sleep(1.0)
        raise RuntimeError(f"sd-server non pronto entro {timeout}s")

    def _load_zimage(self) -> None:
        if self._sd is not None and self._sd.poll() is None:
            self._current = "zimage"
            return
        for p in (SD_EXE, str(ROOT / "models" / "z-image-turbo-Q4_K_M.gguf"),
                  str(ROOT / "models" / "z-image-vae.safetensors"),
                  str(ROOT / "models" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf")):
            if not Path(p).exists():
                raise RuntimeError(f"manca {p} (vedi scripts/copy-models.ps1)")
        Path(SD_LOG).parent.mkdir(parents=True, exist_ok=True)
        t0 = time.perf_counter()
        stdout = open(SD_LOG, "ab", buffering=0)
        self._sd = subprocess.Popen(
            [SD_EXE,
             "--diffusion-model", str(ROOT / "models" / "z-image-turbo-Q4_K_M.gguf"),
             "--vae", str(ROOT / "models" / "z-image-vae.safetensors"),
             "--llm", str(ROOT / "models" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"),
             "--diffusion-fa",
             "--listen-port", str(SD_PORT)],
            stdout=stdout, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            cwd=str(ROOT),
        )
        log.info("sd-server avviato (pid=%s), attendo readiness…", self._sd.pid)
        try:
            self._wait_sd_ready()
        except Exception:
            self._unload()
            raise
        log.info("sd-server pronto in %.1fs", time.perf_counter() - t0)
        self._current = "zimage"

    # ── API pubbliche ──
    def select(self, model: str) -> dict:
        if model not in MODELS:
            raise ValueError(f"modello sconosciuto: {model}")
        with self._lock:
            if self._current == model and model == "bonsai" and self._pipeline is not None:
                return self.status()
            if self._current == model and model == "zimage" and self._sd is not None:
                return self.status()
            self._unload()
            if model == "bonsai":
                self._load_bonsai()
            else:
                self._load_zimage()
            return self.status()

    def generate(self, model: str, prompt: str, steps: int, seed: int,
                 width: int, height: int, count: int) -> list[dict]:
        if model not in MODELS:
            raise ValueError(f"modello sconosciuto: {model}")
        with self._lock:
            # auto-carica se il modello non è quello attivo
            if self._current != model:
                self._unload()
                if model == "bonsai":
                    self._load_bonsai()
                else:
                    self._load_zimage()
            out = []
            for i in range(count):
                eff = seed if seed != -1 else seed  # il hub genera già il seed
                t0 = time.perf_counter()
                if model == "bonsai":
                    data_url = self._gen_bonsai(prompt, eff + i, steps, width, height)
                else:
                    data_url = self._gen_zimage(prompt, eff + i, steps, width, height)
                out.append({
                    "dataUrl": data_url,
                    "timeMs": int((time.perf_counter() - t0) * 1000),
                    "seed": eff + i,
                    "params": {"model": model, "prompt": prompt, "steps": steps,
                               "width": width, "height": height},
                })
            return out

    def _gen_bonsai(self, prompt: str, seed: int, steps: int, width: int, height: int) -> str:
        assert self._pipeline is not None
        png = self._pipeline.generate_png(
            prompt=prompt, seed=seed, steps=steps, height=height, width=width,
        )
        # accumula le nuove forme nella cache autotune persistita
        try:
            GemLiteLinearTriton.cache_config(str(GEMLITE_PERSIST_PATH))
        except Exception as e:
            log.warning("autotune non persistita: %s", e)
        import base64
        return "data:image/png;base64," + base64.b64encode(png).decode("ascii")

    def _gen_zimage(self, prompt: str, seed: int, steps: int, width: int, height: int) -> str:
        import json
        body = json.dumps({
            "prompt": prompt, "width": width, "height": height,
            "steps": steps, "cfg_scale": 1.0, "seed": seed,
        }).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{SD_PORT}/sdapi/v1/txt2img",
            data=body, headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                j = json.loads(r.read().decode())
        except Exception as e:
            raise RuntimeError(f"sd-server: {e}") from e
        if not j.get("images"):
            raise RuntimeError("sd-server: risposta senza immagini")
        return "data:image/png;base64," + j["images"][0]


manager = ModelManager()
app = FastAPI(title="Palamede model server")


class SelectRequest(BaseModel):
    model: str


class GenerateRequest(BaseModel):
    model: str
    prompt: str = Field(min_length=1)
    steps: int = Field(default=4, ge=1, le=50)
    seed: int = Field(default=-1)
    width: int = Field(default=512, ge=16)
    height: int = Field(default=512, ge=16)
    count: int = Field(default=1, ge=1, le=4)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "current": manager.status()["current"]}


@app.get("/models")
def models() -> dict:
    return manager.status()


@app.post("/select")
def select(req: SelectRequest) -> dict:
    try:
        return manager.select(req.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("select %s fallito", req.model)
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/generate")
def generate(req: GenerateRequest) -> dict:
    try:
        images = manager.generate(req.model, req.prompt, req.steps, req.seed,
                                  req.width, req.height, req.count)
        return {"images": images}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("generate %s fallito", req.model)
        raise HTTPException(status_code=500, detail=str(e)) from e


__all__ = ["app", "manager"]