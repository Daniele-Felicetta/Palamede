"""Multi-factor retrieval: R(memory, query, state).

The relevance score combines semantic similarity, recency, importance,
salience, access frequency and contextual relevance. It depends on the current
agent state, not only on the query. Only a small top-k slice ever leaves this
module â€” the active context stays small by construction.
"""

from __future__ import annotations

import hashlib
import math

from .clock import now
from .memory.items import MemoryItem
from .state import AgentState


def embed(text: str, dim: int = 32) -> tuple[float, ...]:
    """Deterministic bag-of-token-hash embedding. No dependencies, stable runs."""
    vec = [0.0] * dim
    for token in text.lower().split():
        h = int(hashlib.sha1(token.encode("utf-8")).hexdigest()[:8], 16)
        vec[h % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return tuple(v / norm for v in vec)


def cosine(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    return sum(a[i] * b[i] for i in range(n))


def _recency(item: MemoryItem, tau: float, current: float) -> float:
    return math.exp(-(current - item.timestamp) / tau)


def _frequency(item: MemoryItem) -> float:
    return item.access_count / (1.0 + item.access_count)


def _contextual(item: MemoryItem, state: AgentState) -> float:
    goal_text = " ".join(state.goals) + " " + str(state.current_context.get("last_action", ""))
    if not goal_text.strip():
        return 0.0
    return cosine(item.embedding, embed(goal_text))


def relevance(
    item: MemoryItem, query: str, state: AgentState, weights: dict[str, float]
) -> float:
    current = now()
    query_emb = embed(query)
    semantic = cosine(item.embedding, query_emb)
    recency = _recency(item, weights.get("recency_tau", 60.0), current)
    importance = min(1.0, item.importance)
    salience = min(1.0, item.salience)
    frequency = _frequency(item)
    contextual = _contextual(item, state)
    return (
        weights.get("w_semantic", 0.45) * semantic
        + weights.get("w_recency", 0.15) * recency
        + weights.get("w_importance", 0.20) * importance
        + weights.get("w_salience", 0.10) * salience
        + weights.get("w_frequency", 0.05) * frequency
        + weights.get("w_context", 0.05) * contextual
    )


class Retrieval:
    def __init__(self, config: dict):
        self.weights = config

    def retrieve(
        self,
        store,
        query: str,
        state: AgentState,
        k: int = 5,
        min_score: float = 0.0,
    ) -> list[MemoryItem]:
        scored = []
        for item in store.all():
            score = relevance(item, query, state, self.weights)
            if score > min_score:
                scored.append((score, item))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        top = [item for _, item in scored[:k]]
        for item in top:
            item.touch()
            store.update(item)
        return top
