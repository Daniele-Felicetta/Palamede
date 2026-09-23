"""Offline replay: re-examines past experiences and reinforces their traces.

Selection prefers importance, surprise (low confidence), reward, prediction
error and recency; the update goes through the same plasticity rule as online
learning and is independent of normal inference.
"""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.memory.event_log import EventLog
from jev_agent.memory.items import Experience, MemoryItem
from jev_agent.memory.sqlite_store import SqliteStore
from jev_agent.plasticity import Plasticity
from jev_agent.replay import Replay


def _experience(action="X", reward=5.0, confidence=0.3, pe=0.7):
    return Experience(
        observation={"text": "signal A"},
        state_before={},
        retrieved_memories=["m1"],
        decision={"action": action, "confidence": confidence,
                  "memory_dependencies": ["m1"]},
        action=action,
        expected_outcome=1 - confidence,
        actual_outcome=1.0 if reward > 0 else 0.0,
        reward=reward,
        prediction_error=pe,
    )


def test_replay_prefers_surprising_high_pe_experiences():
    log = EventLog()
    boring = _experience(reward=1.0, confidence=0.99, pe=0.0)
    surprising = _experience(reward=1.0, confidence=1.0, pe=1.0)
    log.append(boring)
    log.append(surprising)
    picked = Replay(random.Random(0)).select(log, size=1)
    assert picked == [surprising]


def test_replay_strengthens_memory_traces():
    store = SqliteStore(":memory:")
    item = MemoryItem(id="m1", content="e", importance=0.5)
    store.add(item)
    log = EventLog()
    log.append(_experience(reward=5.0, confidence=1.0, pe=0.5))

    updated = Replay(random.Random(0)).replay(log, Plasticity(), store, size=5)
    assert updated == 1
    stored = store.all()[0]
    assert stored.importance > 0.5
    assert stored.access_count > 0
