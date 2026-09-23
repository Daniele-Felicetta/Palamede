"""ContextManager: memory -> retrieval -> context construction -> model.

The KV cache is computational working memory, NOT long-term memory. This
interface keeps the active context small and is the future home for quantized
/ paged / compressed KV caches, prefix caching and sparse attention. It never
materializes the whole memory into the prompt.
"""

from __future__ import annotations

from .memory.items import MemoryItem


class ContextManager:
    def __init__(self, max_memories: int = 6, max_chars: int = 4000):
        self.max_memories = max_memories
        self.max_chars = max_chars
        self.last_context_chars = 0

    def build(
        self,
        memories: list[MemoryItem],
        observation_text: str,
        recent_outcomes: list[dict] | None = None,
    ) -> str:
        lines = [f"Observation: {observation_text}"]
        if recent_outcomes:
            rendered = ", ".join(
                f"{o['action']}->{o['reward']:.1f}" for o in recent_outcomes
            )
            lines.append(f"Recent outcomes (oldest first): {rendered}")
        budget = self.max_chars - len("\n".join(lines))
        used = 0
        for mem in memories[: self.max_memories]:
            block = f"[memory {mem.id[:8]}] {mem.content}"
            if used + len(block) > budget:
                break
            lines.append(block)
            used += len(block)
        context = "\n".join(lines)
        self.last_context_chars = len(context)
        return context
