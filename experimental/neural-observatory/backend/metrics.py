"""Palamede — Osservatorio: cronometro e telemetria.

Tutto quello che mostra la dashboard e' misurato qui con `time.perf_counter`
e `torch.cuda`. Nessuna stima, nessun valore messo a mano: `Timer` chiama
`torch.cuda.synchronize()` prima e dopo, altrimenti su CUDA si misurerebbe
solo il tempo di lancio dei kernel e non quello di esecuzione.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

import torch


def cuda_sync(device: torch.device | str | None = None) -> None:
    """Allinea CPU e GPU. Senza questo i tempi CUDA sono illusori."""
    if torch.cuda.is_available():
        torch.cuda.synchronize(device)


@dataclass
class Span:
    name: str
    ms: float


class Timer:
    """Timer con sincronizzazione CUDA opzionale e righe accumulate."""

    def __init__(self, device: str = "cuda", sync: bool = True):
        self.sync = sync and torch.cuda.is_available()
        self.device = device
        self.spans: list[Span] = []
        self._t0 = 0.0

    @contextmanager
    def span(self, name: str) -> Iterator[None]:
        if self.sync:
            cuda_sync(self.device)
        t0 = time.perf_counter()
        try:
            yield
        finally:
            if self.sync:
                cuda_sync(self.device)
            self.spans.append(Span(name, (time.perf_counter() - t0) * 1000.0))

    def add(self, name: str, ms: float) -> None:
        self.spans.append(Span(name, ms))

    def reset(self) -> None:
        self.spans.clear()

    def get(self, name: str) -> float | None:
        for s in reversed(self.spans):
            if s.name == name:
                return s.ms
        return None

    def total(self) -> float:
        return sum(s.ms for s in self.spans)

    def as_dict(self) -> dict[str, float]:
        """Accorpa gli span ripetuti (gli step) sommandoli."""
        out: dict[str, float] = {}
        for s in self.spans:
            out[s.name] = out.get(s.name, 0.0) + s.ms
        return {k: round(v, 3) for k, v in out.items()}


def vram(device: str = "cuda") -> dict[str, float]:
    """Memoria video: assegnata, riservata, picco. 0 se non c'e' GPU."""
    if not torch.cuda.is_available():
        return {"allocated_mib": 0.0, "reserved_mib": 0.0, "max_allocated_mib": 0.0, "max_reserved_mib": 0.0}
    mib = 2 ** 20
    return {
        "allocated_mib": round(torch.cuda.memory_allocated(device) / mib, 2),
        "reserved_mib": round(torch.cuda.memory_reserved(device) / mib, 2),
        "max_allocated_mib": round(torch.cuda.max_memory_allocated(device) / mib, 2),
        "max_reserved_mib": round(torch.cuda.max_memory_reserved(device) / mib, 2),
    }


def gpu_info(device: str = "cuda") -> dict[str, Any]:
    if not torch.cuda.is_available():
        return {"available": False, "name": None, "total_mib": 0.0,
                "capability": None, "bf16": False, "fp16": False, "tf32": False}
    props = torch.cuda.get_device_properties(device)
    return {
        "available": True,
        "name": props.name,
        "total_mib": round(props.total_memory / 2 ** 20, 1),
        "capability": f"{props.major}.{props.minor}",
        "bf16": torch.cuda.is_bf16_supported(),
        "fp16": True,
        "tf32": torch.cuda.get_device_capability(device) >= (8, 0),
    }


@dataclass
class Throughput:
    tokens: int = 0
    seconds: float = 0.0

    @property
    def tokens_per_second(self) -> float:
        return self.tokens / self.seconds if self.seconds > 0 else 0.0

    def as_dict(self) -> dict[str, float]:
        return {
            "tokens": self.tokens,
            "seconds": round(self.seconds, 6),
            "tokens_per_second": round(self.tokens_per_second, 2),
        }


def throughput(tokens: int, seconds: float) -> Throughput:
    return Throughput(tokens=tokens, seconds=max(seconds, 1e-9))


@dataclass
class StepTiming:
    """Tempi di un singolo optimizer step, in millisecondi."""

    forward_ms: float = 0.0
    backward_ms: float = 0.0
    optimizer_ms: float = 0.0
    analyze_ms: float = 0.0

    @property
    def total_ms(self) -> float:
        return self.forward_ms + self.backward_ms + self.optimizer_ms + self.analyze_ms

    def as_dict(self) -> dict[str, float]:
        return {
            "forward_ms": round(self.forward_ms, 3),
            "backward_ms": round(self.backward_ms, 3),
            "optimizer_ms": round(self.optimizer_ms, 3),
            "analyze_ms": round(self.analyze_ms, 3),
            "total_ms": round(self.total_ms, 3),
        }


@dataclass
class RunTiming:
    """Tempi dell'intero ciclo BEFORE -> TRAIN -> AFTER."""

    load_ms: float = 0.0
    tokenize_ms: float = 0.0
    inference_before_ms: float = 0.0
    loss_before_ms: float = 0.0
    steps: list[StepTiming] = field(default_factory=list)
    analyze_ms: float = 0.0
    inference_after_ms: float = 0.0
    loss_after_ms: float = 0.0

    @property
    def train_ms(self) -> float:
        return sum(s.total_ms for s in self.steps)

    @property
    def total_ms(self) -> float:
        return (self.tokenize_ms + self.inference_before_ms + self.loss_before_ms
                + self.train_ms + self.analyze_ms + self.inference_after_ms + self.loss_after_ms)

    def as_dict(self) -> dict[str, Any]:
        return {
            "load_ms": round(self.load_ms, 3),
            "tokenize_ms": round(self.tokenize_ms, 3),
            "inference_before_ms": round(self.inference_before_ms, 3),
            "loss_before_ms": round(self.loss_before_ms, 3),
            "train_ms": round(self.train_ms, 3),
            "analyze_ms": round(self.analyze_ms, 3),
            "inference_after_ms": round(self.inference_after_ms, 3),
            "loss_after_ms": round(self.loss_after_ms, 3),
            "total_ms": round(self.total_ms, 3),
            "mean_step_ms": round(self.train_ms / len(self.steps), 3) if self.steps else 0.0,
            "steps": [s.as_dict() for s in self.steps],
        }
