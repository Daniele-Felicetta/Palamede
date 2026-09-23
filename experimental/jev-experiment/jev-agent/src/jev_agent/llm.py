"""LLMBackend interface and implementations.

The DecisionModel may use a local Jev-style backend (rizzo-flow) through an
adapter; nothing is hardcoded to a provider. A NullBackend keeps the system
fully offline when no model is available.
"""

from __future__ import annotations

import json
import random
from typing import Any, Protocol

import httpx


class LLMBackend(Protocol):
    def decide(
        self,
        state_text: str,
        context: str,
        actions: list[str],
        memories: list[str],
    ) -> dict[str, Any]: ...


class NullBackend:
    """Offline fallback: uniform probabilities. Used for pure-memory tests."""

    def __init__(self, rng: random.Random | None = None):
        self.rng = rng or random.Random(0)

    def decide(
        self,
        state_text: str,
        context: str,
        actions: list[str],
        memories: list[str],
    ) -> dict[str, Any]:
        probs = {a: 1.0 / len(actions) for a in actions}
        return {
            "action_probabilities": probs,
            "confidence": 1.0 / len(actions),
            "expected_outcome": 0.5,
        }


class RizzoFlowBackend:
    """Adapter for a local rizzo-flow server (`POST /v1/systemone`).

    Jev-compatible wire format: state in, typed questions in parallel, typed
    probabilistic answers out. Zero generated tokens.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:8017", timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @staticmethod
    def _aggregate_cue_actions(
        memories: list[str],
    ) -> dict[str, dict[str, tuple[int, int]]]:
        """Aggregate 'signal X ... -> action Y (...reward=N)' memory lines into
        compact per-(cue, action) evidence. Reads only the memory content shape
        that the agent itself produces."""
        import re

        evidence: dict[str, dict[str, list[int]]] = {}
        pattern = re.compile(
            r"signal (?P<cue>\w+).*->\s*action (?P<action>\w+).*?reward=(?P<reward>\d+\.\d+)"
        )
        for mem in memories:
            match = pattern.search(mem)
            if not match:
                continue
            cue, action = match.group("cue"), match.group("action")
            reward = float(match.group("reward"))
            outcomes = evidence.setdefault(cue, {}).setdefault(action, [0, 0])
            if reward > 0:
                outcomes[0] += 1
            else:
                outcomes[1] += 1
        return evidence

    def decide(
        self,
        state_text: str,
        context: str,
        actions: list[str],
        memories: list[str],
    ) -> dict[str, Any]:
        aggregated = self._aggregate_cue_actions(memories)
        if aggregated:
            lines = []
            for cue_signal, outcomes in aggregated.items():
                summary = ", ".join(
                    f"action {action}: {paid} paid / {failed} failed"
                    for action, (paid, failed) in outcomes.items()
                )
                lines.append(f"- {cue_signal}: {summary}")
            evidence_block = "\n".join(lines)
        else:
            evidence_block = "- no evidence yet"
        state = (
            f"{context or state_text}\n\n"
            f"Aggregated outcomes from past experiences:\n{evidence_block}"
        )
        # Jev fan-out: one independent noul question per action, all answered
        # in parallel against the same state. No position bias in a single
        # choice question; each action is judged on its own.
        questions: dict[str, dict] = {
            f"action_{a}": {
                "type": "noul",
                "instructions": (
                    f"Given the signal, will taking action {a} produce reward "
                    "for this observation? Past experiences show which "
                    "signals paid out after which actions."
                ),
            }
            for a in actions
        }
        questions["expected_outcome"] = {
            "type": "score",
            "instructions": "Given the evidence above, how likely is reward?",
            "criteria": ["Will fail", "Uncertain", "Will succeed"],
        }
        payload = {"state": state, "model": "rizzo-latest", "questions": questions}
        response = httpx.post(
            f"{self.base_url}/v1/systemone", json=payload, timeout=self.timeout
        )
        response.raise_for_status()
        data = response.json()
        answers = data.get("answers", {})

        action_probs = {
            a: float(answers.get(f"action_{a}", {}).get("noul", 0.5)) for a in actions
        }
        best = max(action_probs, key=action_probs.get)

        score_answer = answers.get("expected_outcome", {})
        score_value = float(score_answer.get("score", 1.0))
        n_levels = max(1, len(score_answer.get("legend", {})) - 1)
        expected = score_value / n_levels if n_levels else 0.5

        return {
            "action_probabilities": action_probs,
            "confidence": float(action_probs.get(best, 0.5)),
            "expected_outcome": expected,
            "raw": json.dumps(data.get("usage", {})),
        }
