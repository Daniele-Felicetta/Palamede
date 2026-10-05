"""Palamede — Osservatorio: server FastAPI (porta 8131).

TRASPORTO: SSE + POST, non WebSocket.

Il progetto chiedeva WebSocket. Qui non e' possibile, e il motivo e' preciso
e verificabile: uvicorn 0.52 implementa l'handshake WebSocket solo se trova
`websockets` o `wsproto`, e nel venv che gira l'osservatorio
(`reference/trellis-venv`) non ci sono. Al tentativo di connessione uvicorn
stampa:

    WARNING:  No supported WebSocket library detected. Please use
              "pip install 'uvicorn[standard]'", or install 'websockets' or
              'wsproto' manually.

e risponde 404 all'upgrade. Installarli non e' un'opzione: la rete di lavoro
intercetta il TLS (certificato self-signed nella catena) e ogni `pip install`
fallisce con SSLCertVerificationError. Mettere su un secondo server WebSocket
 scritto a mano sarebbe duplicare lo stesso canale due volte.

Quindi: gli eventi scendono su `GET /api/stream` (`text/event-stream`), i
comandi salgono sui normali endpoint POST. Il canale e' unidirezionale ma
l'effetto e' lo stesso, ed e' gia' il trasporto che questo repo usa per lo
streaming del chat (`hub/lib/proxy.mjs` -> proxyStream, parser SSE in
`frontend/src/lib/text.ts`): il hub lo inoltra senza codice nuovo.

Ogni evento SSE porta `id:` (monotono) e `event:` (il tipo). La UI tiene
l'ultimo id e lo rimandava come `Last-Event-ID`, cosi' una disconnessione
riconnette senza perdere lo stato.

Un solo lock globale protegge modello e trainer: la GPU e' una risorsa singola
e due update contemporanei produrrebbero statistiche mescolate.

Eventi (JSON nel campo `data`):

  hello        stato completo: config, grafo, gpu, cronologia, legenda
  status       cambio di stato del backend (caricato, occupato, in pausa)
  update_start arriva un esempio, con token e perdita BEFORE
  step         un optimizer step e' finito: gradienti per layer, delta, tempi
  paused       in modalita' step: fermo, in attesa di `POST /api/step-advance`
  update_end   ciclo completo: BEFORE/AFTER, tensori, moduli, layer, token
  graph        topologia ricalcolata (dopo un cambio di modalita')
  model_state  modello caricato o scaricato
  history      cronologia azzerata
  error        messaggio con traceback ridotto
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import traceback
from collections import deque
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import graph as graph_mod
from .config import Config
from .metrics import gpu_info, vram
from .model import ModelHost
from .trainer import Trainer

app = FastAPI(title="Palamede Neural Observatory", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # servizio locale su 127.0.0.1, come gli altri backends
    allow_methods=["*"],
    allow_headers=["*"],
)

CFG = Config.load()
HOST = ModelHost(CFG)
TRAINER: Trainer | None = None

# Un solo writer: la GPU non sopporta due update insieme.
LOCK = threading.Lock()
BUSY = threading.Event()
STATE: dict[str, Any] = {"phase": "idle", "detail": "", "error": None, "seq": 0}


# ── hub eventi (SSE) ──────────────────────────────────────────────────
class StreamHub:
    """Fan-out degli eventi, uno stream SSE per client.

    Ogni cliente ha la sua coda: se un browser e' lento, gli eventi si
    accumulano per lui e non rallentano gli altri. Il `seq` e' monotono e
    globale, e gli ultimi 200 eventi restano in memoria: chi si riconnette con
    `Last-Event-ID` li rivede invece di ritrovarsi lo stato vuoto.

    `publish` si puo' chiamare dal thread del trainer (dove sta la GPU) e
    rimanda tutto all'event loop del server.
    """

    KEEP = 200

    def __init__(self) -> None:
        self.queues: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.seq = 0
        self.recent: deque[dict[str, Any]] = deque(maxlen=self.KEEP)

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=512)
        self.queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.queues.discard(q)

    def publish(self, kind: str, payload: dict[str, Any]) -> None:
        if self.loop is None or not self.queues:
            return
        self.seq += 1
        self.recent.append({"id": self.seq, "event": kind, "data": payload})
        asyncio.run_coroutine_threadsafe(self._fanout(), self.loop)

    async def _fanout(self) -> None:
        for q in list(self.queues):
            try:
                q.put_nowait({"id": self.seq, "event": self.recent[-1]["event"],
                              "data": self.recent[-1]["data"]})
            except asyncio.QueueFull:
                # coda satura: butta il piu' vecchio invece di bloccare il
                # trainer. Meglio perdere un frame che fermare un aggiornamento.
                try:
                    q.get_nowait()
                    q.put_nowait({"id": self.seq, "event": self.recent[-1]["event"],
                                  "data": self.recent[-1]["data"]})
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    self.queues.discard(q)

    def backlog(self, last_id: int) -> list[dict[str, Any]]:
        return [e for e in self.recent if e["id"] > last_id]


HUB = StreamHub()


def set_phase(phase: str, detail: str = "", error: str | None = None) -> None:
    STATE["phase"] = phase
    STATE["detail"] = detail
    STATE["error"] = error
    HUB.publish("status", {"state": snapshot_state()})


def snapshot_state() -> dict[str, Any]:
    return {
        **STATE,
        "loaded": HOST.loaded,
        "busy": BUSY.is_set(),
        "updates": TRAINER.updates if TRAINER else 0,
        "vram": vram(str(HOST.device)),
        "gpu": gpu_info(str(HOST.device)),
        "precision": CFG.precision,
        "mode": CFG.mode,
        "device": str(HOST.device),
    }


def ensure_trainer() -> Trainer:
    global TRAINER
    if TRAINER is None:
        if not HOST.loaded:
            HOST.load()
        TRAINER = Trainer(HOST, CFG)
        TRAINER.set_graph(graph_mod.build_graph(HOST.require(), HOST.hf_config))
    return TRAINER


def hello_payload() -> dict[str, Any]:
    tr = TRAINER
    return {
        "config": CFG.to_dict(),
        "state": snapshot_state(),
        "gpu": gpu_info(str(HOST.device)),
        "vram": vram(str(HOST.device)),
        "graph": tr.graph if tr else None,
        "model": HOST.load_info if HOST.loaded else None,
        "mode": HOST.mode_info() if HOST.loaded else None,
        "history": tr.history_summaries() if tr else [],
        "legend": LEGEND,
        "disclaimer": DISCLAIMER,
    }


# Cosa significa ogni segnale visivo. Va nel frontend: un mapping non
# spiegato e' rumore, e l'utente non puo' distinguere una misura da una
# decorazione se non gli si dice quale delle due sta guardando.
LEGEND: list[dict[str, str]] = [
    {
        "channel": "dimensione del nodo",
        "measures": "numero di parametri del gruppo (aggregato, non neuroni)",
        "scale": "radice quadrata, perche' 67M e 3K sulla stessa scala lineare "
                 "darebbero un punto e una macchia",
    },
    {
        "channel": "intensita' emissiva",
        "measures": "norma del gradiente di quel gruppo dopo il backward",
        "scale": "log1p normalizzata sul picco del modello: i gradienti vivono "
                 "su ordini di grandezza diversi",
    },
    {
        "channel": "alone / spessore del bordo",
        "measures": "variazione relativa del peso: ‖δ‖ / ‖w‖ in percentuale",
        "scale": "log1p normalizzata",
    },
    {
        "channel": "colore del nodo",
        "measures": "tipo di layer, categorico: short-conv oppure attention",
        "scale": "nessuna — e' l'unico canale categorico, mai usato per un valore",
    },
    {
        "channel": "pulsa lungo i collegamenti",
        "measures": "attivita': RMS dell'uscita reale del layer di partenza",
        "scale": "lineare sul RMS, animazione a velocita' proporzionale",
    },
    {
        "channel": "spessore del collegamento",
        "measures": "norma del gradiente aggregata sui due capi del collegamento",
        "scale": "log1p normalizzata",
    },
    {
        "channel": "barra per layer",
        "measures": "norma del gradiente di ciascun nodo (non il delta)",
        "scale": "0..100 del picco",
    },
    {
        "channel": "anello punctato",
        "measures": "tensori che hanno ricevuto gradiente ma il cui delta si e' "
                    "azzerato per arrotondamento del formato",
        "scale": "presente / assente",
    },
]

DISCLAIMER = (
    "Nessun nodo e' un neurone: ogni nodo e' un gruppo di tensori di parametri "
    "(una matrice di peso o un vettore di normalizzazione). Le dimensioni, le "
    "norme, i delta e le attivazioni sono misurati sui tensori reali del "
    "checkpoint. Il nodo LM Head e' un alias di Embeddings perche' in questo "
    "modello lm_head.weight e' lo stesso tensor di embed_tokens (tied): non e' "
    "un parametro distinto e non viene contato due volte."
)


# ── API REST: i comandi ──────────────────────────────────────────────
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "neural-observatory", "state": snapshot_state()}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return CFG.to_dict()


@app.post("/api/config")
async def set_config(body: dict[str, Any]) -> JSONResponse:
    try:
        new = Config.from_dict({**CFG.to_dict(), **body})
    except (ValueError, TypeError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return await apply_config(new)


async def apply_config(new: Config) -> JSONResponse:
    """Applica una config validata, ricaricando il modello solo se serve.

    Un cambio di iperparametri (lr, rank, precisione di calcolo) non richiede
    di riaprire i pesi: si ricostruisce solo l'optimizer. Ricaricherebbe da
    zero 230M parametri per cambiare un learning rate.
    """
    global TRAINER
    needs_reload = (
        new.checkpoint != CFG.checkpoint
        or new.master_dtype != CFG.master_dtype
        or new.collect_attention != CFG.collect_attention
    )
    needs_mode = new.mode != CFG.mode
    needs_lora = new.lora != CFG.lora

    previous = CFG.to_dict()
    fresh = Config.from_dict(new.to_dict())
    # `__dict__.update` e non un ciclo di setattr: `to_dict()` ha trasformato
    # `lora` in un dict semplice, e un setattr finirebbe per mettere un dict
    # dove il codice si aspetta una LoRAConfig (poi `.validate()` fallisce).
    CFG.__dict__.update(fresh.__dict__)

    try:
        if needs_reload and HOST.loaded:
            set_phase("loading", "ricarico il checkpoint")
            await asyncio.to_thread(HOST.unload)
            TRAINER = None
            info = await asyncio.to_thread(HOST.load)
            HUB.publish("model_state", {"model": info, "state": snapshot_state()})
        elif HOST.loaded and (needs_mode or needs_lora):
            # `reconfigure_mode` (non `set_mode`): ricostruisce gli adapter da
            # zero anche quando la modalita' non cambia. Se si chiamasse
            # `set_mode` dopo aver gia' scritto CFG.mode, il guard "la modalita'
            # e' gia' questa" azzererebbe tutto e il passaggio a LoRA non
            # applicherebbe nessun adapter, restando sul modello base.
            info = await asyncio.to_thread(HOST.reconfigure_mode, fresh.mode, fresh.lora)
            TRAINER = None
            HUB.publish("model_state", {"model": info, "state": snapshot_state()})
        elif HOST.loaded:
            await asyncio.to_thread(HOST.rebuild_optimizer)
    except Exception as exc:  # noqa: BLE001
        set_phase("error", str(exc), error=traceback.format_exc(limit=3))
        return JSONResponse({"error": str(exc)}, status_code=500)

    if HOST.loaded:
        tr = await asyncio.to_thread(ensure_trainer)
        HUB.publish("graph", {"graph": tr.graph})
    CFG.save()
    set_phase("idle")
    HUB.publish("hello", hello_payload())
    return JSONResponse({"ok": True, "config": CFG.to_dict(), "previous": previous})


# ── azioni ────────────────────────────────────────────────────────────
async def do_load() -> dict[str, Any]:
    set_phase("loading", "carico il checkpoint")
    info = await asyncio.to_thread(HOST.load)
    tr = await asyncio.to_thread(ensure_trainer)
    set_phase("idle")
    HUB.publish("model_state", {"model": info, "state": snapshot_state()})
    HUB.publish("graph", {"graph": tr.graph})
    HUB.publish("hello", hello_payload())
    return info


@app.post("/api/load")
async def api_load() -> JSONResponse:
    if BUSY.is_set():
        return JSONResponse({"error": "busy: c'e' un update in corso"}, status_code=409)
    BUSY.set()
    try:
        info = await do_load()
        return JSONResponse({"ok": True, "model": info})
    except Exception as exc:  # noqa: BLE001
        set_phase("error", str(exc), error=traceback.format_exc(limit=3))
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        BUSY.clear()


@app.post("/api/unload")
async def api_unload() -> JSONResponse:
    global TRAINER
    if BUSY.is_set():
        return JSONResponse({"error": "busy: c'e' un update in corso"}, status_code=409)
    await asyncio.to_thread(HOST.unload)
    TRAINER = None
    set_phase("idle")
    HUB.publish("model_state", {"model": None, "state": snapshot_state()})
    return JSONResponse({"ok": True})


@app.get("/api/graph")
def api_graph() -> JSONResponse:
    if TRAINER is None or TRAINER.graph is None:
        return JSONResponse({"error": "modello non caricato"}, status_code=409)
    return JSONResponse(TRAINER.graph)


@app.get("/api/history")
def api_history() -> dict[str, Any]:
    return {"history": TRAINER.history_summaries() if TRAINER else []}


@app.post("/api/train")
async def api_train(body: dict[str, Any]) -> JSONResponse:
    prompt = (body.get("prompt") or "").strip()
    target = (body.get("target") or "").strip()
    if not prompt or not target:
        return JSONResponse({"error": "prompt e target sono obbligatori"}, status_code=400)
    if not HOST.loaded:
        # Non si carica da soli: un POST /train che nascondesse 2 secondi di
        # caricamento e 5 GB di VRAM renderebbe il tempo di risposta falso.
        return JSONResponse({"error": "modello non caricato: usa POST /api/load"}, status_code=409)
    if BUSY.is_set():
        return JSONResponse({"error": "busy: c'e' un update in corso"}, status_code=409)
    BUSY.set()
    try:
        result = await run_update(prompt, target, int(body.get("steps") or 0) or None)
        return JSONResponse({"ok": True, "update": result})
    except Exception as exc:  # noqa: BLE001
        set_phase("error", str(exc), error=traceback.format_exc(limit=3))
        return JSONResponse({"error": str(exc), "traceback": traceback.format_exc(limit=6)}, status_code=500)
    finally:
        BUSY.clear()


@app.post("/api/generate")
async def api_generate(body: dict[str, Any]) -> JSONResponse:
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        return JSONResponse({"error": "prompt vuoto"}, status_code=400)
    if not HOST.loaded:
        return JSONResponse({"error": "modello non caricato"}, status_code=409)
    if BUSY.is_set():
        return JSONResponse({"error": "busy: c'e' un update in corso"}, status_code=409)
    try:
        out = await asyncio.to_thread(HOST.generate, prompt, body.get("max_new_tokens"))
        return JSONResponse({"ok": True, **out})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/compare")
async def api_compare(body: dict[str, Any]) -> JSONResponse:
    if TRAINER is None:
        return JSONResponse({"error": "nessuna cronologia"}, status_code=409)
    try:
        out = await asyncio.to_thread(TRAINER.compare, int(body["a"]), int(body["b"]))
        return JSONResponse({"ok": True, **out})
    except KeyError as exc:
        return JSONResponse({"error": f"update sconosciuto: {exc}"}, status_code=404)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/clear-history")
async def api_clear() -> JSONResponse:
    if BUSY.is_set():
        return JSONResponse({"error": "busy: c'e' un update in corso"}, status_code=409)
    if TRAINER:
        await asyncio.to_thread(TRAINER.clear_history)
    HUB.publish("history", {"history": []})
    return JSONResponse({"ok": True})


@app.post("/api/reset-model")
async def api_reset() -> JSONResponse:
    """Ricarica il checkpoint da disco: torna ai pesi originali."""
    global TRAINER
    if BUSY.is_set():
        return JSONResponse({"error": "busy: c'e' un update in corso"}, status_code=409)
    BUSY.set()
    try:
        await asyncio.to_thread(HOST.unload)
        TRAINER = None
        info = await do_load()
        return JSONResponse({"ok": True, "model": info})
    except Exception as exc:  # noqa: BLE001
        set_phase("error", str(exc), error=traceback.format_exc(limit=3))
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        BUSY.clear()


@app.get("/api/metrics")
def api_metrics() -> dict[str, Any]:
    return {"vram": vram(str(HOST.device)), "gpu": gpu_info(str(HOST.device)),
            "state": snapshot_state()}


# ── il ciclo di update ───────────────────────────────────────────────
# In modalita' "step" l'update si ferma dopo ogni optimizer step e aspetta
# un `step_advance`: e' il modo per fermarsi su un singolo aggiornamento
# quando il training e' troppo veloce per essere seguito a occhio.
STEP_GATE: asyncio.Event | None = None


async def run_update(prompt: str, target: str, steps: int | None = None) -> dict[str, Any]:
    """Esegue un update e ne inoltra gli eventi.

    In modalita' "step" il ciclo si ferma dopo ogni optimizer step: l'evento
    `step` viene consegnato, il backend va in fase "paused" e aspetta un
    `step_advance`. E' il modo per fermarsi su un singolo aggiornamento
    quando il training e' troppo veloce per essere seguito a occhio.
    """
    tr = ensure_trainer()
    n = int(steps if steps is not None else CFG.steps)
    step_mode = CFG.animation_mode == "step" and n > 1

    global STEP_GATE
    if step_mode:
        STEP_GATE = asyncio.Event()
    gate = STEP_GATE

    def emit(kind: str, payload: dict[str, Any]) -> None:
        """Chiamata dal thread del trainer: rimanda tutto all'event loop."""
        HUB.publish(kind, payload)
        if kind == "step" and step_mode and gate is not None:
            asyncio.run_coroutine_threadsafe(_pause_on_step(gate, payload), HUB.loop)

    async def _pause_on_step(gate: asyncio.Event, payload: dict[str, Any]) -> None:
        step = payload.get("step")
        total = payload.get("steps")
        set_phase("paused", f"step {step} di {total} in attesa")
        HUB.publish("paused", {"step": step, "steps": total, "state": snapshot_state()})
        await gate.wait()

    set_phase("training", f"update #{tr.updates}: {prompt[:40]!r}")
    try:
        return await asyncio.to_thread(tr.update, prompt, target, n, emit)
    finally:
        STEP_GATE = None
        set_phase("idle")


@app.post("/api/step-advance")
async def api_step_advance() -> dict[str, Any]:
    if STEP_GATE is not None:
        STEP_GATE.set()
    return {"ok": True}


# ── stream eventi (SSE) ───────────────────────────────────────────────
@app.get("/api/stream")
async def stream(request: Request) -> StreamingResponse:
    """Il canale degli eventi: `text/event-stream`, unidirezionale.

    I comandi viaggiano sui POST qui sotto. Il primo messaggio e' sempre un
    `hello` con lo stato completo, cosi' un client che si collega a meta'
    training ha comunque il grafo, la config e la cronologia.

    `Last-Event-ID` (che il browser rimanda da solo reconnectando) fa
    recapitare gli eventi persi invece di ricominciare dal vuoto.
    """
    HUB.bind(asyncio.get_running_loop())
    q = HUB.subscribe()

    try:
        last_id = int(request.headers.get("last-event-id") or 0)
    except ValueError:
        last_id = 0

    async def gen():
        try:
            backlog = HUB.backlog(last_id) if last_id else [
                {"id": HUB.seq, "event": "hello", "data": hello_payload()}
            ]
            for ev in backlog:
                yield _sse(ev)
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # tiene viva la connessione
                    continue
                yield _sse(ev)
        finally:
            HUB.unsubscribe(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx/proxy non devono accumulare
        },
    )


def _sse(ev: dict[str, Any]) -> str:
    """Un evento SSE: `id:` monotono, `event:` tipo, `data:` JSON.

    Il tipo sta in `event:` (non dentro il JSON) cosi' il frontend puo'
    smistare con `addEventListener` e non con un if/else per messaggio.
    """
    return (
        f"id: {ev['id']}\n"
        f"event: {ev['event']}\n"
        f"data: {json.dumps(ev['data'], ensure_ascii=False, separators=(',', ':'))}\n\n"
    )


# ── avvio ─────────────────────────────────────────────────────────────
def main() -> None:
    import uvicorn

    print(f"osservatorio neurale — checkpoint {CFG.checkpoint}", flush=True)
    print(f"  http://{CFG.host}:{CFG.port}  (REST + eventi SSE su /api/stream)", flush=True)
    print(f"  precisione {CFG.precision} | modalita' {CFG.mode} | CUDA "
          f"{torch_cuda_available()}", flush=True)
    # ws="none": in questo venv non c'e' un'implementazione WebSocket e
    # uvicorn risponderebbe 404 agli upgrade. Gli eventi passano da SSE.
    uvicorn.run(app, host=CFG.host, port=CFG.port, log_level="warning", ws="none")


def torch_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    main()
