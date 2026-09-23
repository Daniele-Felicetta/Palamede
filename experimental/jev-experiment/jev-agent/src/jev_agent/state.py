"""Persistent, evolving agent state.

The first prototype uses a structured representation; the shape is kept simple
so that it can later be replaced by a learned recurrent state, an SSM, neural
memory or an SNN without touching the rest of the system.
"""

from __future__ import annotations

import hashlib
import struct
import time
from dataclasses import dataclass, field, replace
from typing import Any

from .clock import now


@dataclass
class AgentState:
    current_context: dict[str, Any] = field(default_factory=dict)
    latent_state: tuple[float, ...] = ()
    goals: list[str] = field(default_factory=list)
    confidence: float = 0.5
    timestamp: float = field(default_factory=time.monotonic)

    def update(
        self,
        observation: Any,
        retrieved: list[MemoryItem] | None = None,  # noqa: F821
        action: str | None = None,
        outcome: Any = None,
        momentum: float = 0.9,
    ) -> AgentState:
        """S(t+1) = f(S(t), observation, retrieved_memory, action, outcome)."""
        context = dict(self.current_context)
        if observation is not None:
            text = getattr(observation, "text", None)
            structured = getattr(observation, "structured", None)
            if text is not None:
                context["last_text"] = text
            if structured:
                context["last_structured"] = dict(structured)
            context["last_reward"] = getattr(observation, "reward", None)
        if action is not None:
            context["last_action"] = action
        if outcome is not None:
            context["last_outcome"] = outcome

        latent = self.latent_state
        obs_vec = observation_vector(observation)
        if not latent:
            latent = obs_vec
        else:
            latent = tuple(
                momentum * old + (1.0 - momentum) * new
                for old, new in zip(latent, obs_vec)
            )

        confidence = self.confidence
        if retrieved:
            confidence = 0.5 * confidence + 0.5 * max(m.importance for m in retrieved)
        if outcome is not None:
            ok = getattr(outcome, "ok", None)
            if ok is not None:
                confidence = 0.8 * confidence + 0.2 * (1.0 if ok else 0.0)

        return replace(
            self,
            current_context=context,
            latent_state=latent,
            confidence=confidence,
            timestamp=now(),
        )


def observation_vector(observation: Any, dim: int = 8) -> tuple[float, ...]:
    """Deterministic low-dimensional summary of an observation.

    A stand-in for an encoder network: hash-based but stable, so the same
    observation always maps to the same latent vector.
    """
    label = getattr(observation, "text", None) or str(getattr(observation, "structured", ""))
    reward = getattr(observation, "reward", None)
    vec: list[float] = []
    for i in range(dim):
        digest = hashlib.sha256(f"{label}\x00{i}".encode()).digest()
        h = struct.unpack(">I", digest[:4])[0]
        vec.append(((h >> 8) / 0x1000000) * 2.0 - 1.0)
    if reward is not None:
        vec[-1] = max(-1.0, min(1.0, reward))
    return tuple(vec)
