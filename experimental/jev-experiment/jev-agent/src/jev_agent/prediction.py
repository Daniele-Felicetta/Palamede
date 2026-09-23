"""Prediction error: expected vs actual outcome, kept separate from reward.

A high prediction error boosts the salience/importance of the associated
memory even when the reward itself is neutral — surprising experiences must
not be forgotten.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PredictionError:
    error: float  # |expected - actual| in [0, 1]
    expected: float
    actual: float

    @staticmethod
    def compute(expected: float, actual: float) -> PredictionError:
        return PredictionError(
            error=min(1.0, abs(expected - actual)), expected=expected, actual=actual
        )
