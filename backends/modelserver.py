"""Palamede — modello server unico e dinamico (:8000).

Un solo processo serve tutti i modelli immagine, uno alla volta:

- **bonsai** (gemlite in-process, GpuPipeline)  — caricato su /select;
- **zimage / klein / qwenimage** (stable-diffusion.cpp ``sd-server``) —
  avviati come subprocess gestito dal server e terminati al deselezione,
  così la VRAM si libera.

POST /select {model} scarica il modello corrente e carica quello richiesto;
POST /generate auto-carica se serve. Tutto è serializzato da un lock, quindi
mai due generazioni simultanee (regola di prodotto: un modello alla volta).
"""
from __future__ import annotations

import gc
import logging
import os
import random
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
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
# Text encoder su CPU (RAM) invece che VRAM: risparmia ~2,3 GB, l'encoding
# avviene una volta sola per immagine. 1 = attivo (default), 0 = tutto su GPU.
SD_TE_CPU = os.environ.get("PALAMEDE_SD_TE_CPU", "1") != "0"

# Klein 4B (FLUX.2) — GGUF Q4 in download; VAE flux2 e text encoder Qwen3
# riusati dal lavoro gia' fatto in reference/bonsai.
KLEIN_DIFFUSION = os.environ.get(
    "PALAMEDE_KLEIN_DIFFUSION", str(ROOT / "models" / "flux-2-klein-4b-q4.gguf"))
KLEIN_VAE = os.environ.get(
    "PALAMEDE_KLEIN_VAE",
    str(BONSAI_REPO / "models" / "FLUX.2-klein-4B" / "vae" / "diffusion_pytorch_model.safetensors"))
KLEIN_LLM = os.environ.get(
    "PALAMEDE_KLEIN_LLM", str(ROOT / "models" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"))


def _resolve_klein_diffusion() -> str:
    """GGUF di klein: il nome del download puo' variare (Q4_K_M, q4, ...):
    usa il path esatto se esiste, altrimenti trova qualsiasi *klein*.gguf."""
    exact = os.environ.get(
        "PALAMEDE_KLEIN_DIFFUSION", str(ROOT / "models" / "flux-2-klein-4b-q4.gguf"))
    if Path(exact).exists():
        return exact
    cands = sorted((ROOT / "models").glob("*klein*.gguf"))
    if cands:
        return str(cands[0])
    return exact

MODELS = {
    "bonsai": {"name": "Bonsai 4B ternary", "engine": "gemlite (in-process)"},
    "zimage": {"name": "Z-Image Turbo Q4_K_M", "engine": "stable-diffusion.cpp (sd-server)"},
    "klein": {"name": "Klein 4B Q4 (FLUX.2)", "engine": "stable-diffusion.cpp (sd-server, flux2)"},
    "qwenimage": {"name": "Qwen-Image 2.1 Q4_K_M", "engine": "stable-diffusion.cpp (sd-server, qwen-image)"},
}

# Modelli serviti da sd-server (subprocess gestito, uno alla volta).
SD_MODELS = ("zimage", "klein", "qwenimage")

# cfg_scale / sampler per modello sd-server: i distillati (Z-Image, Klein)
# escono con cfg 1.0 (= 0 effettivo), Qwen-Image è un modello CFG "vero"
# (6.0, sampler euler, 40 step di default come da guida unsloth).
# "cache" = caching dei blocchi DiT: utile solo con molti step (Qwen, 40):
# cache-dit misura ~2.4× sul sampling senza perdita visibile.
SD_GEN = {
    "zimage": {"cfg": 1.0, "sampler": None},
    "klein": {"cfg": 1.0, "sampler": None},
    "qwenimage": {"cfg": 6.0, "sampler": "euler", "cache": "cache-dit"},
}

# Caching DiT attivo di default (0 = disattiva, per confronti qualità/tempo).
SD_CACHE = os.environ.get("PALAMEDE_SD_CACHE", "1") != "0"

class ModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: str | None = None
        self._pipeline: GpuPipeline | None = None
        self._sd: subprocess.Popen | None = None
        self._sd_model: str | None = None
        self._sd_log = None  # handle del log sd-server (chiuso a ogni unload)

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
    def _close_sd_log(self) -> None:
        fh, self._sd_log = self._sd_log, None
        if fh is not None:
            try:
                fh.close()
            except Exception:
                pass

    def _kill_sd(self) -> None:
        proc, self._sd = self._sd, None
        self._sd_model = None
        if proc is None:
            self._close_sd_log()
            return
        log.info("terminazione sd-server (pid=%s)", proc.pid)
        try:
            proc.terminate()
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=5)
            except Exception:
                log.warning("sd-server non terminato pulitamente")
        finally:
            self._close_sd_log()

    def _unload(self) -> None:
        if self._current == "bonsai" and self._pipeline is not None:
            log.info("unload bonsai: libero VRAM")
            self._pipeline = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        if self._current in SD_MODELS and self._sd is not None:
            log.info("unload %s: terminazione sd-server", self._current)
            self._kill_sd()
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

    def _sd_files(self, model: str) -> tuple[str, str, str, str]:
        """(diffusion, vae, text-encoder, vae-format) per un modello sd-server.

        Il text-encoder può essere `--llm` (Z-Image/Klein, Qwen): chi
        chiama sceglie il flag in base al modello. Il ritorno è sempre
        (diffusion, vae, encoder, vae-format).
        """
        if model == "zimage":
            return (str(ROOT / "models" / "z-image-turbo-Q4_K_M.gguf"),
                    str(ROOT / "models" / "z-image-vae.safetensors"),
                    str(ROOT / "models" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"),
                    "auto")
        if model == "klein":
            return (_resolve_klein_diffusion(), KLEIN_VAE, KLEIN_LLM, "flux2")
        if model == "qwenimage":
            qwen_dir = ROOT / "models" / "qwen-image"
            return (str(qwen_dir / "qwen-image-2.1-Q4_K_M.gguf"),
                    str(qwen_dir / "qwen_image_2.1_vae_bf16.safetensors"),
                    str(qwen_dir / "Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf"),
                    "auto")
        raise ValueError(f"modello sconosciuto: {model}")

    def _load_sd(self, model: str) -> None:
        # server gia' attivo con QUESTO modello: riusa (niente doppio carico)
        if self._sd is not None and self._sd.poll() is None and self._sd_model == model:
            self._current = model
            return
        # cambio modello: termina il server precedente (libera VRAM)
        if self._sd is not None:
            self._kill_sd()
        diffusion, vae, encoder, vae_format = self._sd_files(model)
        missing = [p for p in (diffusion, vae, encoder) if not Path(p).exists()]
        if missing:
            raise RuntimeError(
                f"mancano file per {model}: {', '.join(missing)} — "
                "completa il download (vedi scripts/copy-models.ps1)")
        Path(SD_LOG).parent.mkdir(parents=True, exist_ok=True)
        cmd = [SD_EXE,
               "--diffusion-model", diffusion,
               "--vae", vae,
               "--diffusion-fa",
               "--listen-port", str(SD_PORT)]
        # il text encoder è --llm (Z-Image/Klein, Qwen)
        cmd += ["--llm", encoder]
        if SD_TE_CPU:
            # TE su RAM: ~2,3 GB risparmiati in VRAM, encoding una tantum su CPU
            cmd += ["--backend", "te=cpu"]
        if vae_format != "auto":
            cmd += ["--vae-format", vae_format]
        # caching DiT (solo modelli con molti step, es. Qwen-Image 40 step)
        cache = SD_GEN.get(model, {}).get("cache") if SD_CACHE else None
        if cache:
            cmd += ["--cache-mode", cache]
        t0 = time.perf_counter()
        self._close_sd_log()
        stdout = open(SD_LOG, "ab", buffering=0)
        self._sd_log = stdout
        self._sd = subprocess.Popen(
            cmd, stdout=stdout, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            cwd=str(ROOT),
        )
        log.info("sd-server (%s) avviato (pid=%s), attendo readiness…", model, self._sd.pid)
        try:
            self._wait_sd_ready()
        except Exception:
            self._unload()
            raise
        self._sd_model = model
        self._current = model
        log.info("sd-server (%s) pronto in %.1fs", model, time.perf_counter() - t0)

    # ── API pubbliche ──
    def select(self, model: str) -> dict:
        if model not in MODELS:
            raise ValueError(f"modello sconosciuto: {model}")
        with self._lock:
            if self._current == model and model == "bonsai" and self._pipeline is not None:
                return self.status()
            # sd-server potrebbe essere morto nel frattempo: controlla che
            # il processo sia vivo, altrimenti ricarica invece di riuscire a vuoto
            if (self._current == model and self._sd is not None
                    and self._sd_model == model and self._sd.poll() is None):
                return self.status()
            self._unload()
            if model == "bonsai":
                self._load_bonsai()
            else:
                self._load_sd(model)
            return self.status()

    def generate(self, model: str, prompt: str, steps: int, seed: int,
                 width: int, height: int, count: int,
                 image: str | None = None, strength: float = 0.6,
                 preview: bool = False, preview_interval: int = 8,
                 preview_mode: str = "vae") -> list[dict]:
        if model not in MODELS:
            raise ValueError(f"modello sconosciuto: {model}")
        if image and model == "bonsai":
            raise ValueError("bonsai non supporta image-to-image (usa zimage, klein o qwenimage)")
        # il VAE richiede multipli di 32: snap difensivo (la UI invia preset validi)
        width = max(64, (int(width) // 32) * 32)
        height = max(64, (int(height) // 32) * 32)
        with self._lock:
            # auto-carica se il modello non è quello attivo, o se sd-server
            # è morto nel frattempo (respawn invece di "connection refused")
            sd_dead = (model in SD_MODELS
                       and (self._sd is None or self._sd.poll() is not None))
            if self._current != model or sd_dead:
                self._unload()
                if model == "bonsai":
                    self._load_bonsai()
                else:
                    self._load_sd(model)
            # preview in streaming: configurata una volta per generazione
            if model in SD_MODELS:
                self.configure_preview(preview, preview_interval, preview_mode)
            out = []
            rng = random.SystemRandom()
            for i in range(count):
                # seed -1 → casuale vero qui (il hub inoltra il body tal quale).
                eff = seed if seed != -1 else rng.randint(0, 2**31 - 1)
                t0 = time.perf_counter()
                if model == "bonsai":
                    data_url = self._gen_bonsai(prompt, eff + i, steps, width, height)
                else:
                    data_url = self._gen_sd(model, prompt, eff + i, steps, width, height,
                                            image, strength)
                out.append({
                    "dataUrl": data_url,
                    "timeMs": int((time.perf_counter() - t0) * 1000),
                    "seed": eff + i,
                    "params": {"model": model, "prompt": prompt, "steps": steps,
                               "width": width, "height": height,
                               "img2img": bool(image), "strength": strength},
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

    def _gen_sd(self, model: str, prompt: str, seed: int, steps: int,
                width: int, height: int,
                image: str | None, strength: float) -> str:
        import json
        gen = SD_GEN.get(model, {})
        body = {
            "prompt": prompt, "width": width, "height": height,
            "steps": steps, "cfg_scale": gen.get("cfg", 1.0), "seed": seed,
        }
        if gen.get("sampler"):
            body["sampler_name"] = gen["sampler"]
        url = f"http://127.0.0.1:{SD_PORT}/sdapi/v1/txt2img"
        if image:
            # img2img: dataUrl → base64 nudo, con la forza di denoise richiesta
            b64 = image.split(",", 1)[1] if image.startswith("data:") else image
            body["init_images"] = [b64]
            body["denoising_strength"] = strength
            url = f"http://127.0.0.1:{SD_PORT}/sdapi/v1/img2img"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                j = json.loads(r.read().decode())
        except Exception as e:
            raise RuntimeError(f"sd-server: {e}") from e
        if not j.get("images"):
            raise RuntimeError("sd-server: risposta senza immagini")
        return "data:image/png;base64," + j["images"][0]

    # ── preview in streaming (sd-server patchato: /sdcpp/v1/preview) ──
    def configure_preview(self, enabled: bool, interval: int = 8,
                          mode: str = "vae") -> None:
        """Abilita/disabilita la preview per-step su sd-server (best-effort).

        I modelli bonsai non hanno preview; se sd-server non è attivo la
        chiamata è un no-op (la preview è puramente diagnostica, non blocca).
        """
        if self._sd is None or self._sd.poll() is not None:
            return
        import json
        body = json.dumps({"enabled": bool(enabled),
                           "interval": max(1, int(interval)),
                           "mode": mode}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{SD_PORT}/sdcpp/v1/preview/config",
            data=body, headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5):
                pass
        except Exception as e:
            log.warning("preview config fallita: %s", e)

    def get_preview(self) -> bytes | None:
        """Ultimo frame di preview (PNG) di sd-server, o None se assente."""
        if self._sd is None or self._sd.poll() is not None:
            return None
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{SD_PORT}/sdcpp/v1/preview", timeout=5) as r:
                if r.status == 204:
                    return None
                data = r.read()
                return data or None
        except Exception:
            return None


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
    image: str | None = None  # dataUrl: img2img (modelli sd-server)
    strength: float = Field(default=0.6, ge=0.05, le=1.0)
    preview: bool = False  # preview in streaming (solo modelli sd-server)
    preview_interval: int = Field(default=8, ge=1, le=40)
    preview_mode: str = "vae"  # vae | tae | proj


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


@app.get("/preview")
def preview():
    """Ultimo frame di preview del modello sd-server (image/png) o 204."""
    data = manager.get_preview()
    if not data:
        return Response(status_code=204)
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "no-store"})


@app.post("/generate")
def generate(req: GenerateRequest) -> dict:
    try:
        images = manager.generate(req.model, req.prompt, req.steps, req.seed,
                                  req.width, req.height, req.count,
                                  req.image, req.strength,
                                  req.preview, req.preview_interval, req.preview_mode)
        return {"images": images}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("generate %s fallito", req.model)
        raise HTTPException(status_code=500, detail=str(e)) from e


__all__ = ["app", "manager"]