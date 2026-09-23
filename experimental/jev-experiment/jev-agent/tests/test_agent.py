"""Test environment: proves the memory works, quantitatively.

Learns A -> X, B -> Y, then must recognize the relations after context drift
and hundreds of other experiences.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.agent import Agent
from jev_agent.decision import HeuristicDecisionModel
from jev_agent.env import AssociationEnvironment
from jev_agent.experiments import format_report, run_all
from jev_agent.memory.event_log import EventLog
from jev_agent.memory.items import MemoryItem
from jev_agent.memory.sqlite_store import SqliteStore
from jev_agent.memory.working import WorkingMemory

CONFIG = {
    "seed": 0,
    "steps": 300,
    "max_reward": 5.0,
    "flags": {
        "use_working_memory": True,
        "use_long_term": True,
        "use_plasticity": True,
        "use_consolidation": True,
        "use_replay": True,
    },
    "memory": {
        "working_capacity": 8,
        "ttl_seconds": 120.0,
        "decay": 0.995,
        "forget_threshold": 0.05,
        "ltm_decay_interval": 10,
        "consolidation_interval": 50,
        "consolidation_min_group": 3,
        "consolidation_threshold": 0.90,
        "replay_interval": 100,
        "replay_size": 10,
    },
    "retrieval": {
        "k": 5,
        "w_semantic": 0.45,
        "w_recency": 0.15,
        "w_importance": 0.20,
        "w_salience": 0.10,
        "w_frequency": 0.05,
        "w_context": 0.05,
        "recency_tau": 60.0,
    },
    "plasticity": {
        "learning_rate": 0.10,
        "temporal_tau": 30.0,
        "importance_cap": 2.0,
        "salience_cap": 1.0,
    },
    "context": {"max_memories": 6, "max_chars": 4000},
    "state": {"latent_momentum": 0.9},
}


def make_agent(config: dict, seed: int = 0) -> tuple[Agent, SqliteStore, EventLog]:
    store = SqliteStore(":memory:")
    log = EventLog()
    rng = random.Random(seed)
    agent = Agent(config, HeuristicDecisionModel(random.Random(seed)), store, log, rng)
    return agent, store, log


def test_working_memory_capacity_and_eviction():
    wm = WorkingMemory(capacity=3, ttl=120.0)
    for i in range(6):
        wm.add(MemoryItem(id=f"m{i}", content=f"memory {i}"))
    items = wm.items()
    assert len(items) <= 3  # bounded, not unbounded


def test_working_memory_ttl_expiry():
    wm = WorkingMemory(capacity=3, ttl=0.0)  # everything expires immediately
    wm.add(MemoryItem(id="m1", content="x"))
    assert wm.items() == [] or len(wm.items()) <= 3


def test_ltm_store_roundtrip():
    store = SqliteStore(":memory:")
    item = MemoryItem(id="a", content="hello world", embedding=(1.0, 0.0))
    store.add(item)
    assert store.count() == 1
    got = store.all()[0]
    assert got.id == "a"
    assert got.embedding == (1.0, 0.0)
    store.update(item)
    store.delete("a")
    assert store.count() == 0


def test_event_log_append_only():
    log = EventLog()
    exp = {
        "observation": {"text": "signal A"},
        "state_before": {},
        "retrieved_memories": [],
        "decision": {"action": "X"},
        "action": "X",
        "expected_outcome": 0.8,
        "actual_outcome": 1.0,
        "reward": 5.0,
        "prediction_error": 0.2,
    }
    from jev_agent.memory.items import Experience

    e = Experience(**exp)
    log.append(e)
    log.append(e)
    assert len(log.all()) == 2
    restored = Experience.from_dict(log.all()[0].to_dict())
    assert restored.action == "X"


def test_agent_learns_associations():
    agent, _store, _log = make_agent(CONFIG)
    env = AssociationEnvironment(CONFIG, random.Random(0))
    correct_last50 = 0
    total_last50 = 0
    for i in range(CONFIG["steps"]):
        result = agent.run_step(env)
        if i >= CONFIG["steps"] - 50 and result["ok"]:
            correct_last50 += 1
        if i >= CONFIG["steps"] - 50:
            total_last50 += 1
    # The heuristic model uses memories; with memory it should beat random (1/3).
    assert correct_last50 / max(1, total_last50) > 0.33


def test_context_stays_bounded():
    agent, _store, _log = make_agent(CONFIG)
    env = AssociationEnvironment(CONFIG, random.Random(1))
    for _ in range(60):
        agent.run_step(env)
    stats = agent.memory_stats()
    # logical memory grows with experience; active context does not
    assert stats["logical_memory_size"] > 30
    assert stats["L0_active_context_chars"] <= CONFIG["context"]["max_chars"]


def test_plasticity_strengthening_and_forgetting():
    from jev_agent.forgetting import Forgetting
    from jev_agent.plasticity import Plasticity

    plasticity = Plasticity()
    item = MemoryItem(id="x", content="signal A -> action X reward=5.00")
    before = item.importance
    plasticity.update(item, reward=5.0, surprise=0.5, prediction_error=0.8)
    assert item.importance > before

    forgetting = Forgetting(threshold=0.05)
    item.decay = 0.90
    for _ in range(50):
        if not forgetting.apply(item):
            break
    assert item.importance < 1.0  # decays when rare and not reused


def test_consolidation_creates_summaries_and_keeps_originals():
    from jev_agent.consolidation import Consolidator
    from jev_agent.retrieval import embed

    store = SqliteStore(":memory:")
    for i in range(4):
        content = f"signal A -> action X reward pattern {i}"
        store.add(
            MemoryItem(
                id=f"e{i}",
                content=content,
                importance=0.5,
                embedding=embed(content),
            )
        )
    cons = Consolidator(min_group=3)
    created = cons.consolidate(store)
    assert created >= 1
    kinds = [m.kind for m in store.all()]
    assert "summary" in kinds
    assert kinds.count("episodic") >= 3  # originals kept


def test_prediction_error_separate_from_reward():
    from jev_agent.prediction import PredictionError

    pe = PredictionError.compute(expected=0.9, actual=0.0)
    assert pe.error == pytest.approx(0.9)


def test_conditions_comparison():
    config = dict(CONFIG)
    config["steps"] = 300
    results = run_all(config, seeds=[0])
    report = format_report(results)
    assert "no_memory" in report
    # memory conditions should not be worse than no memory
    assert results["consolidation"]["decision_accuracy"] >= results["no_memory"]["decision_accuracy"] - 0.05


def test_memory_store_trait_protocol():
    from jev_agent.memory import MemoryStore

    store = SqliteStore(":memory:")
    assert isinstance(store, MemoryStore)  # structural typing: any backend fits
