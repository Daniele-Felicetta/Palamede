"""Plasticity: STDP-inspired, reward- and surprise-modulated memory updates.

NOT biologically equivalent to STDP and NOT a real neuromorphic mechanism;
it is a neuromorphic-inspired update rule. The interface allows replacing it
later with real STDP, reward-modulated STDP, learned plasticity or a
differentiable memory update.
"""

from __future__ import annotations

import math

from .clock import now
from .memory.items import MemoryItem


class Plasticity:
    def __init__(
        self,
        learning_rate: float = 0.10,
        temporal_tau: float = 30.0,
        importance_cap: float = 2.0,
        salience_cap: float = 1.0,
    ):
        self.learning_rate = learning_rate
        self.temporal_tau = temporal_tau
        self.importance_cap = importance_cap
        self.salience_cap = salience_cap

    def temporal_factor(self, memory_timestamp: float) -> float:
        dt = max(0.0, now() - memory_timestamp)
        return math.exp(-dt / self.temporal_tau)

    @staticmethod
    def reward_factor(reward: float, max_reward: float = 5.0) -> float:
        return max(-1.0, min(1.0, reward / max_reward)) if max_reward else 0.0

    def update(
        self,
        item: MemoryItem,
        reward: float,
        surprise: float,
        prediction_error: float,
        relevance: float = 1.0,
    ) -> None:
        """dw = lr * temporal * (reward + |prediction_error| + surprise) * relevance.

        Positive reward or high prediction error / surprise strengthen the
        memory; negative reward weakens it. Surprise and prediction error are
        deliberately separate contributions.
        """
        temporal = self.temporal_factor(item.timestamp)
        magnitude = (
            self.learning_rate
            * temporal
            * (self.reward_factor(reward) + abs(prediction_error) + surprise)
            * max(0.0, min(1.0, relevance))
        )
        item.importance = max(0.0, min(self.importance_cap, item.importance + magnitude))
        item.salience = max(0.0, min(self.salience_cap, item.salience + 0.5 * magnitude))
