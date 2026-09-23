"""Memory items and append-only experience events."""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

from ..clock import now


@dataclass
class MemoryItem:
    id: str
    content: str
    timestamp: float = field(default_factory=time.monotonic)
    importance: float = 0.5
    salience: float = 0.5
    access_count: int = 0
    decay: float = 0.995
    embedding: tuple[float, ...] = ()
    kind: str = "episodic"  # episodic | summary | link
    source_ids: tuple[str, ...] = ()
    last_access: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.access_count += 1
        self.last_access = now()


@dataclass(frozen=True)
class Experience:
    """One full agent step, append-only event log record."""

    observation: dict[str, Any]
    state_before: dict[str, Any]
    retrieved_memories: list[str]
    decision: dict[str, Any]
    action: str
    expected_outcome: float
    actual_outcome: float
    reward: float
    prediction_error: float
    timestamp: float = field(default_factory=time.monotonic)
    id: str = field(default_factory=lambda: uuid.uuid4().hex)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> Experience:
        return Experience(**d)
