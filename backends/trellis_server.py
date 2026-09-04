"""Palamede — TRELLIS.2 image-to-3D server (:8124).

Genera mesh 3D texturizzate (PBR) da una singola immagine tramite la pipeline
TRELLIS.2 (Microsoft), esportate in GLB. Il runtime gira sul venv SEPARATO
`reference\trellis-venv` (Python 3.13 + torch CUDA nativo: flex_gemm, cumesh,
o_voxel, nvdiffrast).

Per usare TRELLIS è necessario:
  1. aggiungere `models/TRELLIS.2` al sys.path;
  2. settare ATTN_BACKEND=sdpa PRIMA di importare torch (evita flash_attn);
  3. il codice in models/TRELLIS.2 è patchato per supportare sdpa.

POST /generate {image(dataUrl), pipeline_type, seed, num_samples} → GLB
(texturizzato) restituito come base64 + salvato su outputs/3d/. Un modello alla
volta: le generazioni sono serializzate da un lock (come il modello server).
"""
from __future__ import annotations

import base64
import io
import logging
import os
import random
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

# ── setup TRELLIS — PRIMA di importare torch/trellis ────────────────────────
# ATTN_BACKEND=sdpa evita flash_attn (non installato in questo venv); va fissato
# prima di torch. expandable_segments riduce lo "out of memory" per i picchi.
os.environ.setdefault("ATTN_BACKEND", "sdpa")
os.environ.setdefault(
    "PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True"
)

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger("palamede.trellis")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

ROOT = Path(__file__).resolve().parents[1]
TRELLIS_REPO = ROOT / "models" / "TRELLIS.2"
MODEL_DIR = ROOT / "models" / "TRELLIS.2-4B"
OUTPUTS3D = ROOT / "outputs" / "3d"

# models/TRELLIS.2 contiene il package `trellis2`: va sul sys.path PRIMA di
# importarlo, altrimenti Python non lo trova.
if str(TRELLIS_REPO) not in sys.path:
    sys.path.insert(0, str(TRELLIS_REPO))

import torch  # noqa: E402

from trellis2.pipelines import Trellis2ImageTo3DPipeline  # noqa: E402

TRELLIS_PORT = int(os.environ.get("PALAMEDE_TRELLIS_PORT", "8124"))


class TrellisManager:
    """Gestisce il caricamento lazy e la generazione serializzata."""

    def __init__(self) -> None:
        self._lock = threading.Lock()  # noqa: F821
        self._pipeline: Trellis2ImageTo3DPipeline | None = None
        self._loading = False
        self.load_time_s: float | None = None

    # ── stato ──
    @property
    def loading(self) -> bool:
        return self._loading

    @property
    def ready(self) -> bool:
        return self._pipeline is not None

    def status(self) -> dict:
        return {
            "ready": self.ready,
            "loading": self.loading,
            "load_time_s": round(self.load_time_s, 1) if self.load_time_s else None,
        }

    # ── caricamento lazy ──
    def _ensure_loaded(self) -> None:
        if self._pipeline is not None:
            return
        if self._loading:
            raise RuntimeError("TRELLIS.2 sta ancora caricando; riprova tra qualche secondo")
        self._loading = True
        t0 = time.perf_counter()
        try:
            if not MODEL_DIR.exists():
                raise FileNotFoundError(
                    f"checkpoint TRELLIS.2 mancante in {MODEL_DIR} — "
                    "scarilo in models/TRELLIS.2-4B (vedi SPEC.md)"
                )
            log.info("caricamento pipeline TRELLIS.2 da %s ...", MODEL_DIR)
            pipeline = Trellis2ImageTo3DPipeline.from_pretrained(str(MODEL_DIR))
            pipeline.to("cuda")
            self._pipeline = pipeline
            self.load_time_s = time.perf_counter() - t0
            log.info("pipeline TRELLIS.2 pronta in %.1fs", self.load_time_s)
        except Exception:
            self._loading = False
            raise

    # ── preload all'avvio (best-effort) ──
    def preload(self) -> None:
        """Carica la pipeline in background all'avvio, così /status passa a
        ready=true senza dover aspettare la prima generazione. Se il checkpoint
        manca o la VRAM non basta, fallisce in silenzio: la prima generazione
        ricaricherà comunque (il comportamento lazy resta come fallback)."""
        if self._pipeline is not None or self._loading:
            return
        threading.Thread(target=self._preload_worker, daemon=True).start()

    def _preload_worker(self) -> None:
        try:
            self._ensure_loaded()
            log.info("preload TRELLIS.2 completato in %.1fs", self.load_time_s)
        except Exception:
            self._loading = False
            log.exception("preload TRELLIS.2 fallito (ricarico alla prima generazione)")

    # ── generazione ──
    def generate(
        self,
        image_dataurl: str,
        pipeline_type: str = "512",
        seed: int = -1,
        num_samples: int = 1,
    ) -> dict:
        if not image_dataurl or "," not in image_dataurl:
            raise ValueError("image: dataUrl mancante (attesa data:image/...;base64,...)")
        if pipeline_type not in ("512", "1024"):
            raise ValueError(f"pipeline_type non supportato: {pipeline_type} (usa 512 o 1024)")
        if num_samples < 1 or num_samples > 4:
            raise ValueError("num_samples deve essere tra 1 e 4")

        rng = random.SystemRandom()
        eff_seed = seed if seed != -1 else rng.randint(0, 2**31 - 1)

        with self._lock:
            self._ensure_loaded()
            pipeline = self._pipeline
            assert pipeline is not None

            # decodifica il dataUrl → PIL Image (RGB/RGBA)
            image = _decode_image(image_dataurl)

            t0 = time.perf_counter()
            try:
                meshes = pipeline.run(
                    image,
                    num_samples=num_samples,
                    seed=eff_seed,
                    pipeline_type=pipeline_type,
                )
                mesh = meshes[0]

                # esporta GLB texturizzato (PBR) come nel test funzionante.
                # Texture PNG (NON WebP): EXT_texture_webp non è supportato da
                # Blender (crash all'apertura); i viewer online sì. PNG = compatibile.
                # o_voxel è un nativo compilato: lo importo pigro solo qui, così
                # il server parte veloce e non paga l'import a ogni run.
                import o_voxel  # noqa: E402
                pp = o_voxel.postprocess
                OUTPUTS3D.mkdir(parents=True, exist_ok=True)
                id_str = f"{int(time.time()*1000)}-{rng.randint(0, 999999)}"
                glb_path = OUTPUTS3D / f"{id_str}.glb"
                glb = pp.to_glb(
                    vertices=mesh.vertices,
                    faces=mesh.faces,
                    attr_volume=mesh.attrs,
                    coords=mesh.coords,
                    attr_layout=pipeline.pbr_attr_layout,
                    voxel_size=mesh.voxel_size,
                    aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                    decimation_target=100000,
                    texture_size=1024,
                    remesh=True,
                    remesh_band=1,
                    remesh_project=0,
                    verbose=False,
                )
                glb.export(str(glb_path))

                # STL (solo geometria, per stampa 3D/import in altri tool): trimesh è
                # già nel venv TRELLIS. I tensori vanno portati su CPU e convertiti.
                import trimesh
                stl_path = OUTPUTS3D / f"{id_str}.stl"
                tri = trimesh.Trimesh(
                    vertices=mesh.vertices.detach().cpu().numpy(),
                    faces=mesh.faces.detach().cpu().numpy(),
                )
                tri.export(str(stl_path))
            finally:
                torch.cuda.empty_cache()

            gen_s = time.perf_counter() - t0
            vram_after = _vram_peak_gb()

            # leggi il file per restituirlo in base64 (download immediato)
            glb_bytes = glb_path.read_bytes()
            glb_b64 = base64.b64encode(glb_bytes).decode("ascii")

        return {
            "glb_base64": f"data:model/gltf-binary;base64,{glb_b64}",
            "path": str(glb_path),
            "url": f"/api/3d/file/{id_str}.glb",
            "stl_url": f"/api/3d/file/{id_str}.stl",
            "vertices": int(mesh.vertices.shape[0]),
            "faces": int(mesh.faces.shape[0]),
            "time_s": round(gen_s, 1),
            "vram_peak_gb": round(vram_after, 2),
            "seed": eff_seed,
            "pipeline_type": pipeline_type,
        }


manager = TrellisManager()

# ── request/response bodies ────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    image: str
    pipeline_type: str = Field(default="512")
    seed: int = Field(default=-1)
    num_samples: int = Field(default=1, ge=1, le=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # preload del modello in background: /status passa a ready=true da solo,
    # senza aspettare la prima generazione (il lazy resta come fallback).
    manager.preload()
    yield


app = FastAPI(title="Palamede TRELLIS.2 3D server", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/status")
def status() -> dict:
    return manager.status()


@app.post("/generate")
def generate(req: GenerateRequest) -> dict:
    try:
        return manager.generate(
            req.image,
            pipeline_type=req.pipeline_type,
            seed=req.seed,
            num_samples=req.num_samples,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("generazione 3D fallita")
        raise HTTPException(status_code=500, detail=str(e)) from e


# ── helper ─────────────────────────────────────────────────────────────────
def _decode_image(dataurl: str):
    """dataUrl (base64) → PIL Image. Supporta PNG/JPEG/WEBP, RGB o RGBA."""
    from PIL import Image

    header, _, b64 = dataurl.partition(",")
    if not b64:
        raise ValueError("dataUrl senza payload base64")
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw)).convert("RGBA" if "rgba" in header.lower() else "RGB")


def _vram_peak_gb() -> float:
    """VRAM usata ora (GB). Richiede torch.cuda disponibile."""
    try:
        if torch.cuda.is_available():
            return torch.cuda.max_memory_allocated() / 2**30
    except Exception:
        pass
    return 0.0


__all__ = ["app", "manager"]
