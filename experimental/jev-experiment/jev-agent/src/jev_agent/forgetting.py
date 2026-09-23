"""Forgetting: decay model with stabilization.

importance(t+1) = importance(t) * decay, modified by repeated access, reward,
surprise and recency. Frequent + useful memories stabilize; rare + irrelevant
ones fade; surprising ones get a temporary boost.
"""

from __future__ import annotations

from .clock import now
from .memory.items import MemoryItem


class Forgetting:
    def __init__(self, threshold: float = 0.05):
        self.threshold = threshold

    def apply(self, item: MemoryItem) -> bool:
        """Decay one item. Returns False if it should be forgotten."""
        current = now()
        recency_factor = 1.0 / (1.0 + max(0.0, current - item.timestamp) / 300.0)
        access_factor = 1.0 + 0.05 * item.access_count
        effective_decay = min(1.0, item.decay * recency_factor * access_factor)
        item.importance *= effective_decay
        return not item.importance < self.threshold

    def sweep(self, store) -> int:
        """Decay every item; delete those below threshold. Returns removed count."""
        removed = 0
        for item in store.all():
            if not self.apply(item):
                store.delete(item.id)
                removed += 1
            else:
                store.update(item)
        return removed
