"""One resident Spark model, one persistent inference thread.

Decisions go through rizzo-flow's Engine (typed, zero generated tokens).
Dialogues go through the raw model ("vanilla": it actually generates text).
Both run on the same long-lived thread: MLX's CUDA backend aborts the process
when a thread that ran inference exits, so no inference ever runs on a
short-lived web-server thread.
"""

from __future__ import annotations

import os
import queue
import re
import threading
from concurrent.futures import Future
from pathlib import Path

MODEL_NAME = "Spark-X2.5-4B"
_PREFIX = re.compile(r"^[A-ZÀ-Ý][\w'’ -]{1,18}:\s*")
_MARKERS = ("<|User|>", "<|Bot|>", "<|System|>", "<|Tool|>", "｜", "</think>", "<think>")


def find_model_path(explicit: str | Path | None = None) -> Path:
    if explicit:
        path = Path(explicit)
        if (path / "config.json").exists():
            return path
        raise FileNotFoundError(f"Not a Spark checkpoint: {path}")
    env = os.environ.get("SPARK_MODEL_PATH")
    if env and (Path(env) / "config.json").exists():
        return Path(env)
    here = Path(__file__).resolve()
    for parent in list(here.parents)[:5]:
        for candidate in (parent / "models" / MODEL_NAME, parent / "rizzo-flow" / "models" / MODEL_NAME):
            if (candidate / "config.json").exists():
                return candidate
    raise FileNotFoundError(
        f"Checkpoint {MODEL_NAME} not found. Run `rizzo download` in rizzo-flow, "
        "or pass --model / set SPARK_MODEL_PATH."
    )


def clean_text(text: str) -> str:
    for marker in _MARKERS:
        index = text.find(marker)
        if index != -1:
            text = text[:index]
    lines = [line.strip(" \t-•*\"'") for line in text.replace("\r", "").split("\n")]
    lines = [line for line in lines if line]
    out = lines[0] if lines else ""
    out = _PREFIX.sub("", out)
    if len(out) > 320:
        out = out[:317].rstrip() + "…"
    return out


def _sample(row, temperature: float, top_k: int, seed: int) -> int:
    import mlx.core as mx

    row = row.astype(mx.float32)
    if top_k and int(top_k) < row.size:
        threshold = mx.sort(row)[-int(top_k)]
        row = mx.where(row < threshold, mx.array(-float("inf")), row)
    if temperature is None or temperature <= 0:
        return int(mx.argmax(row).item())
    if hasattr(mx.random, "seed"):  # newer MLX may only expose explicit keys
        mx.random.seed(int(seed))
    token = mx.random.categorical((row / temperature)[None, :])
    return int(token[0].item())


class InferenceHub:
    def __init__(
        self,
        model_path: str | Path | None = None,
        bits: int | None = 8,
        device: str = "auto",
        ctx: int = 4096,
        prewarm: bool = True,
    ) -> None:
        self.model_path = find_model_path(model_path)
        self.bits = bits
        self.device = device
        self.ctx = ctx
        self.backend = None
        self.engine = None
        self._load_error: Exception | None = None
        self._status_lock = threading.Lock()
        self._status = {"state": "cold", "detail": "modello non caricato"}
        self._queue: queue.Queue = queue.Queue()
        self._worker = threading.Thread(
            target=self._loop, name="encounter-inference", daemon=True
        )
        self._worker.start()
        if prewarm:
            self.submit("load", None)

    # -- public ---------------------------------------------------------
    def status(self) -> dict:
        with self._status_lock:
            return dict(self._status)

    def decide(self, request: dict, timeout: float = 180.0) -> dict:
        return self.submit("decide", request).result(timeout=timeout)

    def generate(
        self,
        messages: list[dict],
        max_tokens: int = 72,
        temperature: float = 0.8,
        top_k: int = 40,
        seed: int = 0,
        timeout: float = 180.0,
    ) -> str:
        payload = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_k": top_k,
            "seed": seed,
        }
        return self.submit("generate", payload).result(timeout=timeout)

    def submit(self, kind: str, payload) -> Future:
        future: Future = Future()
        self._queue.put((kind, payload, future))
        return future

    # -- worker ---------------------------------------------------------
    def _loop(self) -> None:
        while True:
            kind, payload, future = self._queue.get()
            try:
                if kind == "load":
                    self._load()
                    value = self.status()
                elif kind == "decide":
                    value = self._decide(payload)
                elif kind == "generate":
                    value = self._generate(payload)
                else:
                    raise ValueError(f"Unknown job: {kind}")
                if not future.cancelled():
                    future.set_result(value)
            except BaseException as exc:  # noqa: BLE001 - forwarded to the caller
                if not future.cancelled():
                    future.set_exception(exc)

    def _set_status(self, state: str, detail: str) -> None:
        with self._status_lock:
            self._status = {"state": state, "detail": detail}

    def _load(self) -> None:
        if self.engine is not None:
            return
        if self._load_error is not None:
            raise self._load_error
        self._set_status("loading", f"carico {self.model_path.name}…")
        try:
            from rizzo_flow.backend import SparkBackend
            from rizzo_flow.engine import Engine

            backend = SparkBackend.load(self.model_path, bits=self.bits, device=self.device)
        except Exception as exc:
            self._load_error = exc
            self._set_status("error", f"caricamento fallito: {exc}")
            raise
        self.backend = backend
        self.engine = Engine(backend, ctx=self.ctx)
        seconds = backend.metadata.get("load_seconds", 0.0)
        self._set_status("ready", f"{self.model_path.name} pronto ({seconds:.0f}s)")

    def _decide(self, request: dict) -> dict:
        self._load()
        return self.engine.decide(request)

    def _generate(self, payload: dict) -> str:
        self._load()
        import mlx.core as mx

        tokenizer = self.backend.tokenizer
        model = self.backend.model
        prompt = tokenizer.apply_chat_template(
            payload["messages"],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        ids = tokenizer.encode(prompt, add_special_tokens=False)
        cache = model.make_cache()
        logits = None
        for offset in range(0, len(ids), 512):
            logits = model(mx.array([ids[offset : offset + 512]]), cache=cache)
            mx.eval(logits)
        stop_ids = self._stop_ids(tokenizer)
        produced: list[int] = []
        for _ in range(int(payload["max_tokens"])):
            token = _sample(
                logits[0, -1, :],
                payload["temperature"],
                payload["top_k"],
                payload["seed"],
            )
            if token in stop_ids:
                break
            produced.append(token)
            logits = model(mx.array([[token]]), cache=cache)
            mx.eval(logits)
        return clean_text(tokenizer.decode(produced))

    @staticmethod
    def _stop_ids(tokenizer) -> set[int]:
        stop: set[int] = set()
        for value in (
            getattr(tokenizer, "eos_token_id", None),
            getattr(tokenizer, "pad_token_id", None),
            getattr(tokenizer, "bos_token_id", None),
        ):
            if isinstance(value, int):
                stop.add(value)
            elif isinstance(value, (list, tuple)):
                stop.update(int(v) for v in value)
        return stop
