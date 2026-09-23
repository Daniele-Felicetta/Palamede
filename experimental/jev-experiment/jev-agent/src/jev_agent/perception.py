"""Observations, actions and the environment interface."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class Observation:
    """One input from the environment. Not assumed to be textual only."""

    timestamp: float
    text: str | None
    structured: dict[str, Any] | None
    metadata: dict[str, Any] = field(default_factory=dict)
    reward: float | None = None
    previous_action_result: str | None = None

    @staticmethod
    def now(
        text: str | None = None,
        structured: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Observation:
        return Observation(
            timestamp=time.monotonic(), text=text, structured=structured, **kwargs
        )


@dataclass(frozen=True)
class Action:
    name: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionResult:
    ok: bool
    reward: float
    detail: str


class Environment(Protocol):
    """Abstract environment. Concrete worlds implement observe/act."""

    def observe(self) -> Observation: ...

    def act(self, action: Action) -> ActionResult: ...
