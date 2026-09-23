"""The decision layer: typed questions answered by rizzo-flow.

`RizzoDecisions` is the real thing (probabilities from Spark logits, zero
generated tokens). `LocalDecisions` is a small offline stand-in used only when
the model cannot be loaded, so the game stays playable and the UI can say so.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from . import prompts


def _argmax(distribution: dict[str, float]) -> str:
    return max(distribution, key=distribution.get) if distribution else ""


@dataclass(frozen=True)
class Decision:
    question: str
    kind: str
    status: str
    probabilities: dict[str, float]
    legend: dict[str, str]
    value: Any
    suggestion: str
    source: str

    def to_dict(self) -> dict:
        return {
            "question": self.question,
            "kind": self.kind,
            "status": self.status,
            "probabilities": {k: round(v, 4) for k, v in self.probabilities.items()},
            "legend": self.legend,
            "value": self.value,
            "suggestion": self.suggestion,
            "source": self.source,
        }


def _from_answer(question: str, kind: str, answer: dict) -> Decision:
    probabilities = {k: float(v) for k, v in answer["probabilities"].items()}
    legend = dict(answer.get("legend", {}))
    if kind == "boolean":
        value = answer.get("value")
        suggestion = "true" if value else "false"
    elif kind == "choice":
        value = answer.get("choice")
        suggestion = value if value is not None else _argmax(probabilities)
    else:
        value = answer.get("score")
        suggestion = str(round(value)) if value is not None else _argmax(probabilities)
    return Decision(
        question=question,
        kind=kind,
        status=answer.get("status", "ok"),
        probabilities=probabilities,
        legend=legend,
        value=value,
        suggestion=suggestion,
        source="rizzo",
    )


class RizzoDecisions:
    def __init__(self, hub) -> None:
        self.hub = hub

    def _ask(self, state: dict, questions: dict) -> dict:
        return self.hub.decide({"state": state, "questions": questions})["answers"]

    def engage(self, npc: dict, session) -> Decision:
        state, questions = prompts.engagement_request(npc, session)
        return _from_answer("engage", "boolean", self._ask(state, questions)["engage"])

    def attitude(self, npc: dict, session, player_line: str, npc_line: str) -> Decision:
        state, questions = prompts.attitude_request(npc, session, player_line, npc_line)
        return _from_answer("attitude", "score", self._ask(state, questions)["attitude"])

    def action(self, npc: dict, session) -> Decision:
        state, questions = prompts.action_request(npc, session)
        return _from_answer("action", "choice", self._ask(state, questions)["action"])


class LocalDecisions:
    """Offline fallback: simple trait/relationship arithmetic, still probabilistic."""

    def __init__(self, seed: int = 0) -> None:
        self.rng = random.Random(seed)

    def engage(self, npc: dict, session) -> Decision:
        state = session.npc(npc["id"])
        score = npc["traits"]["friendly"] + 0.15 * state.relationship - 0.1 * state.talks
        p_true = max(0.05, min(0.95, 0.35 + 0.5 * score))
        probabilities = {"true": p_true, "false": 1 - p_true}
        value = p_true >= 0.5
        return Decision(
            "engage",
            "boolean",
            "ok",
            probabilities,
            {"true": "Sì: conviene parlargli.", "false": "No: meglio proseguire."},
            value,
            "true" if value else "false",
            "local",
        )

    def attitude(self, npc: dict, session, player_line: str, npc_line: str) -> Decision:
        state = session.npc(npc["id"])
        level = 2 + round(state.relationship / 2) + (1 if len(player_line) > 12 else 0)
        level = max(0, min(4, int(level)))
        probabilities = {str(i): 0.05 for i in range(5)}
        probabilities[str(level)] = 0.8
        total = sum(probabilities.values())
        probabilities = {k: v / total for k, v in probabilities.items()}
        return Decision(
            "attitude",
            "score",
            "ok",
            probabilities,
            {str(i): prompts.ATTITUDE_LEVELS[i] for i in range(5)},
            float(level),
            str(level),
            "local",
        )

    def action(self, npc: dict, session) -> Decision:
        options = prompts.available_actions(npc, session)
        weights = {action: 0.2 for action in options}
        state = session.npc(npc["id"])
        if "ask_rumor" in options:
            weights["ask_rumor"] = 1.0
        if "trade" in options and npc["traits"]["greed"] >= 0.5:
            weights["trade"] = 0.7
        if "give_potion" in options and state.relationship >= 0:
            weights["give_potion"] = 0.5
        weights["leave"] = 0.15
        total = sum(weights.values())
        probabilities = {action: weight / total for action, weight in weights.items()}
        suggestion = _argmax(probabilities)
        return Decision(
            "action",
            "choice",
            "ok",
            probabilities,
            {action: prompts.world.ACTIONS[action]["description"] for action in options},
            suggestion,
            suggestion,
            "local",
        )
