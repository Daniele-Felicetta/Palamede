"""Metrics for memory and decision quality.

Key metric: logical memory size vs active context size — the system must
accumulate many experiences without growing the context linearly.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class Metrics:
    decisions: int = 0
    correct: int = 0
    reward_total: float = 0.0
    prediction_errors: list[float] = field(default_factory=list)
    retrieved_counts: list[int] = field(default_factory=list)
    context_sizes: list[int] = field(default_factory=list)
    logical_sizes: list[int] = field(default_factory=list)
    latencies: list[float] = field(default_factory=list)
    storage_chars: int = 0

    def record(self, step_result: dict, logical_size: int, storage_chars: int) -> None:
        self.decisions += 1
        self.correct += 1 if step_result["ok"] else 0
        self.reward_total += step_result["reward"]
        self.prediction_errors.append(step_result["prediction_error"])
        self.retrieved_counts.append(step_result["retrieved"])
        self.logical_sizes.append(logical_size)
        self.storage_chars = storage_chars

    def summary(self) -> dict:
        n = max(1, self.decisions)
        return {
            "decisions": self.decisions,
            "decision_accuracy": self.correct / n,
            "mean_reward": self.reward_total / n,
            "mean_prediction_error": sum(self.prediction_errors) / n,
            "mean_retrieved": sum(self.retrieved_counts) / n,
            "mean_context_chars": (
                sum(self.context_sizes) / len(self.context_sizes)
                if self.context_sizes
                else 0.0
            ),
            "final_logical_memory_size": self.logical_sizes[-1] if self.logical_sizes else 0,
            "storage_chars": self.storage_chars,
            "mean_latency_ms": (
                sum(self.latencies) / len(self.latencies) * 1000.0 if self.latencies else 0.0
            ),
            # logical vs active: the whole point of the architecture
            "logical_to_active_ratio": (
                (self.logical_sizes[-1] / max(1, self.context_sizes[-1]))
                if self.logical_sizes and self.context_sizes
                else 0.0
            ),
        }


class RetrievalScorer:
    """Precision/recall of retrieval against known-relevant memory ids."""

    def __init__(self):
        self.hits = 0
        self.selected = 0
        self.relevant = 0

    def score(self, retrieved_ids: list[str], relevant_ids: set[str]) -> None:
        self.selected += len(retrieved_ids)
        self.relevant += len(relevant_ids)
        self.hits += len(set(retrieved_ids) & relevant_ids)

    def precision(self) -> float:
        return self.hits / self.selected if self.selected else 0.0

    def recall(self) -> float:
        return self.hits / self.relevant if self.relevant else 0.0


def retention_curve(importances_over_time: list[list[float]]) -> list[float]:
    """Mean normalized importance at each sweep; shows decay/stabilization."""
    return [
        sum(imp) / max(1, len(imp)) for imp in importances_over_time
    ]


def now() -> float:
    return time.monotonic()
