"""Consolidation: episodic memories -> stable knowledge.

Merges similar memories, raises importance, creates summaries and links,
removes exact duplicates, keeps the original episodic records when they still
matter. Raw experiences are NOT automatically converted into summaries.
"""

from __future__ import annotations

import itertools
import uuid

from .clock import now
from .memory.items import MemoryItem
from .retrieval import cosine


class Consolidator:
    def __init__(
        self,
        threshold: float = 0.72,
        min_group: int = 3,
        importance_boost: float = 0.1,
    ):
        self.threshold = threshold
        self.min_group = min_group
        self.importance_boost = importance_boost

    def consolidate(self, store) -> int:
        """One consolidation pass. Returns the number of summaries created."""
        items = [i for i in store.all() if i.kind == "episodic"]
        groups = self._cluster(items)
        created = 0
        for group in groups:
            if len(group) < self.min_group:
                continue
            summary = self._merge(group)
            store.add(summary)
            for item in group:
                item.importance = min(2.0, item.importance + self.importance_boost)
                item.kind = "episodic"  # originals are kept, not deleted
                store.update(item)
            created += 1
        self._dedup(store)
        return created

    def _cluster(self, items: list[MemoryItem]) -> list[list[MemoryItem]]:
        groups: list[list[MemoryItem]] = []
        for item in items:
            placed = False
            for group in groups:
                if cosine(item.embedding, group[0].embedding) >= self.threshold:
                    group.append(item)
                    placed = True
                    break
            if not placed:
                groups.append([item])
        return groups

    def _merge(self, group: list[MemoryItem]) -> MemoryItem:
        contents = [i.content for i in group]
        # Common tokens across the group become the summary content.
        token_sets = [set(c.lower().split()) for c in contents]
        common = set.intersection(*token_sets) if token_sets else set()
        summary_text = "pattern: " + " ".join(sorted(common)) if common else contents[0]
        from .retrieval import embed

        return MemoryItem(
            id=uuid.uuid4().hex,
            content=summary_text,
            timestamp=now(),
            importance=min(2.0, max(i.importance for i in group) + self.importance_boost),
            salience=min(1.0, max(i.salience for i in group)),
            kind="summary",
            source_ids=tuple(i.id for i in group),
            embedding=embed(summary_text),
        )

    @staticmethod
    def _dedup(store) -> int:
        """Remove duplicate SUMMARIES only. Repeated identical episodes are
        legitimate evidence (frequency matters) and are never deleted."""
        seen: set[str] = set()
        removed = 0
        for item in store.all():
            if item.kind != "summary":
                continue
            if item.content in seen:
                store.delete(item.id)
                removed += 1
            else:
                seen.add(item.content)
        return removed


def unused(*_args) -> None:  # keep itertools import meaningful if API evolves
    itertools.count()
