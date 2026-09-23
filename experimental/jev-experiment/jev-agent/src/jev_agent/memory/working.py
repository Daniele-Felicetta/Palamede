"""Working memory: bounded, decaying active store with eviction.

NOT an unbounded context window. Items carry importance, salience, recency and
access frequency; eviction removes the least useful item when capacity is hit.
"""

from __future__ import annotations

from ..clock import now
from .items import MemoryItem


class WorkingMemory:
    def __init__(self, capacity: int = 8, ttl: float = 120.0, decay: float = 0.995):
        self.capacity = capacity
        self.ttl = ttl
        self.default_decay = decay
        self._items: list[MemoryItem] = []
        self._last_tick: float | None = None

    def add(self, item: MemoryItem) -> None:
        self._items.append(item)
        if len(self._items) > self.capacity:
            self._evict()

    def tick(self) -> None:
        """Advance time: decay importance, expire TTL items.

        Idempotent within one logical instant: several reads in the same step
        must not decay the same item multiple times.
        """
        current = now()
        if self._last_tick == current:
            return
        self._last_tick = current
        alive = []
        for item in self._items:
            item.importance *= item.decay
            if current - item.timestamp <= self.ttl and item.importance > 0.01:
                alive.append(item)
        self._items = alive

    def items(self) -> list[MemoryItem]:
        self.tick()
        return list(self._items)

    def _evict(self) -> None:
        """Eviction policy: lowest usefulness score is removed first."""
        current = now()

        def usefulness(item: MemoryItem) -> float:
            recency = 1.0 / (1.0 + current - item.last_access)
            freq = item.access_count / (1.0 + item.access_count)
            return item.importance * (0.5 + 0.5 * recency) + 0.2 * item.salience + 0.1 * freq

        victim = min(self._items, key=usefulness)
        self._items.remove(victim)
