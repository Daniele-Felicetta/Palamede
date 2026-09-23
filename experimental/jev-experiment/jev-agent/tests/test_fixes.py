"""Regression tests for the bugs fixed in the memory/decision loop."""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.agent import Agent
from jev_agent.clock import now
from jev_agent.config import load_config
from jev_agent.decision import HeuristicDecisionModel
from jev_agent.env import AssociationEnvironment
from jev_agent.memory.event_log import EventLog
from jev_agent.memory.items import MemoryItem
from jev_agent.memory.sqlite_store import SqliteStore
from jev_agent.memory.working import WorkingMemory
from jev_agent.perception import Observation
from jev_agent.state import observation_vector


def test_observation_vector_is_process_stable():
    """Built-in hash() is salted per process; the vector must not be."""
    vec = observation_vector(Observation.now(text="signal A fog"))
    expected = (
        0.899924,
        0.578257,
        -0.403882,
        0.238529,
        -0.455144,
        0.766784,
        -0.9901,
        -0.689495,
    )
    assert vec == pytest.approx(expected, abs=1e-6)


def test_working_memory_tick_is_idempotent_within_a_step():
    wm = WorkingMemory(capacity=4, ttl=120.0, decay=0.5)
    wm.add(MemoryItem(id="m1", content="x", importance=0.8, timestamp=now()))
    wm.tick()
    after_one = wm.items()[0].importance
    wm.tick()
    wm.tick()
    assert wm.items()[0].importance == after_one


def test_retrieval_does_not_duplicate_working_memory():
    config = load_config(None)
    config["steps"] = 20
    store = SqliteStore(":memory:")
    agent = Agent(config, HeuristicDecisionModel(random.Random(0)), store, EventLog())
    env = AssociationEnvironment(config, random.Random(0))
    for _ in range(20):
        result = agent.run_step(env)
    ids = result["retrieved_ids"]
    assert len(ids) == len(set(ids)), "same memory handed to the model twice"


def test_logical_memory_is_not_double_counted():
    config = load_config(None)
    config["steps"] = 30
    store = SqliteStore(":memory:")
    agent = Agent(config, HeuristicDecisionModel(random.Random(0)), store, EventLog())
    env = AssociationEnvironment(config, random.Random(0))
    for _ in range(30):
        agent.run_step(env)
    stats = agent.memory_stats()
    distinct = {m.id for m in store.all()}
    assert stats["logical_memory_size"] == len(distinct)
    assert stats["logical_memory_size"] <= stats["L2_ltm_size"] + stats["L1_working_memory_size"]
