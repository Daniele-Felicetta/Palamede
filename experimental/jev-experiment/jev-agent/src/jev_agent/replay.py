"""Experience replay: offline re-examination of past experiences.

Selects past experiences by importance, surprise, reward, prediction error
and recency, independent of normal inference.
"""

from __future__ import annotations

import random

from .memory.event_log import EventLog
from .memory.items import Experience


class Replay:
    def __init__(self, rng: random.Random | None = None):
        self.rng = rng or random.Random(0)

    def select(
        self,
        log: EventLog,
        size: int = 10,
        weights: dict[str, float] | None = None,
    ) -> list[Experience]:
        w = weights or {}
        w_importance = w.get("importance", 0.3)
        w_surprise = w.get("surprise", 0.3)
        w_reward = w.get("reward", 0.2)
        w_error = w.get("prediction_error", 0.2)
        w_recency = w.get("recency", 0.1)

        records = log.all()
        if not records:
            return []
        scored = []
        for i, exp in enumerate(records):
            recency = (i + 1) / len(records)
            score = (
                w_importance * abs(exp.reward)
                + w_surprise * (1.0 - exp.decision.get("confidence", 0.0))
                + w_reward * max(0.0, exp.reward)
                + w_error * exp.prediction_error
                + w_recency * recency
            )
            scored.append((score, i, exp))
        scored.sort(key=lambda t: (t[0], -t[1]), reverse=True)
        picked = [exp for _, _, exp in scored[:size]]
        self.rng.shuffle(picked)
        return picked

    def replay(self, log: EventLog, plasticity, store, size: int = 10) -> int:
        """Re-examine selected experiences: strengthen their memory traces."""

        updated = 0
        for exp in self.select(log, size=size):
            for mem_id in exp.decision.get("memory_dependencies", []):
                items = [m for m in store.all() if m.id == mem_id]
                for item in items:
                    plasticity.update(
                        item,
                        reward=exp.reward,
                        surprise=0.2,
                        prediction_error=exp.prediction_error,
                        relevance=0.8,
                    )
                    item.touch()
                    store.update(item)
                    updated += 1
        return updated
