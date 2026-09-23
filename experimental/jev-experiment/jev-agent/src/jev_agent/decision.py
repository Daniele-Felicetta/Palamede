"""DecisionModel interface and concrete implementations.

Jev-style: unstructured state in, typed probabilistic decisions out. The model
never generates text; it picks among the candidate actions and returns
calibrated probabilities. No chain-of-thought is required â€” structured outputs
only.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any, Protocol

from .clock import now
from .llm import LLMBackend


@dataclass(frozen=True)
class Decision:
    """Structured decision, Jev-shaped."""

    action: str
    score: float
    confidence: float
    probabilities: dict[str, float]
    reasoning_state: str = ""
    memory_dependencies: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "score": self.score,
            "confidence": self.confidence,
            "probabilities": dict(self.probabilities),
            "reasoning_state": self.reasoning_state,
            "memory_dependencies": list(self.memory_dependencies),
        }


class DecisionModel(Protocol):
    def decide(
        self,
        state: Any,
        observation: Any,
        retrieved: list[Any],
        possible_actions: list[str],
        context: str = "",
    ) -> Decision: ...


class HeuristicDecisionModel:
    """Deterministic memory-driven baseline.

    Scores each action by how often past memories associate it with reward in
    contexts similar to the current observation. Evidence is recency-weighted:
    recent outcomes dominate stale ones, so the agent can adapt to drift and
    conflicting associations. Works offline with no model.
    """

    def __init__(self, rng: random.Random | None = None, recency_tau: float = 60.0):
        self.rng = rng or random.Random(0)
        self.recency_tau = recency_tau

    def decide(
        self,
        state: Any,
        observation: Any,
        retrieved: list[Any],
        possible_actions: list[str],
        context: str = "",
    ) -> Decision:
        obs_text = (getattr(observation, "text", None) or "").lower()
        obs_tokens = set(obs_text.split())
        scores = {a: 0.01 for a in possible_actions}
        deps: list[str] = []
        current = now()
        for mem in retrieved:
            text = mem.content.lower()
            if "reward" not in text:
                continue
            failed = "no reward" in text
            mem_tokens = set(text.split())
            # relative overlap: evidence counts only if the memory is actually
            # about the current situation, not just about "signal -> action"
            cue_match = len(obs_tokens & mem_tokens) > 1
            overlap = len(obs_tokens & mem_tokens) / max(1, len(mem_tokens))
            if not cue_match:
                continue
            recency = math.exp(-max(0.0, current - mem.last_access) / self.recency_tau)
            for action in possible_actions:
                if action.lower() in text:
                    weight = mem.importance * (1.0 + overlap) * recency
                    # positive evidence supports the action, negative evidence
                    # (a failure with that action) speaks against it
                    scores[action] += -weight if failed else weight
                    deps.append(mem.id)
        # softmax over raw scores: sign-safe normalization (scores can be
        # negative because failures count as evidence against an action)
        exps = {a: math.exp(s) for a, s in scores.items()}
        norm = sum(exps.values()) or 1.0
        probs = {a: e / norm for a, e in exps.items()}
        best = max(probs, key=probs.get)
        return Decision(
            action=best,
            score=probs[best],
            confidence=probs[best],
            probabilities=probs,
            reasoning_state="heuristic",
            memory_dependencies=deps,
        )


class JevDecisionModel:
    """Decision model backed by rizzo-flow (local Jev-style typed decisions).

    One fan-out request per step: a `choice` over the candidate actions, a
    `score` for the expected outcome, and a `noul` for memory relevance.
    Surprise for plasticity is derived as 1 - P(chosen action).
    """

    def __init__(self, backend: LLMBackend):
        self.backend = backend

    def decide(
        self,
        state: Any,
        observation: Any,
        retrieved: list[Any],
        possible_actions: list[str],
        context: str = "",
    ) -> Decision:
        obs_text = getattr(observation, "text", None) or str(
            getattr(observation, "structured", "")
        )
        memory_texts = [m.content for m in retrieved]
        state_block = context or obs_text
        answers = self.backend.decide(
            state_text=obs_text,
            context=state_block,
            actions=possible_actions,
            memories=memory_texts,
        )
        probs = answers["action_probabilities"]
        best = max(probs, key=probs.get)
        deps = [m.id for m in retrieved][: len(memory_texts)]
        return Decision(
            action=best,
            score=probs[best],
            confidence=answers.get("confidence", probs[best]),
            probabilities=probs,
            reasoning_state="jev",
            memory_dependencies=deps,
        )

