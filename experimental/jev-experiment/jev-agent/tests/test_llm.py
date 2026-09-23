"""Offline test for the rizzo-flow (Jev-style) adapter — no server needed.

The backend contract: state in, typed questions, typed probabilistic answers
out, zero generated tokens.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.decision import HeuristicDecisionModel, JevDecisionModel
from jev_agent.llm import NullBackend
from jev_agent.memory.items import MemoryItem
from jev_agent.perception import Observation
from jev_agent.state import AgentState


def _fake_response_payload(actions):
    return {
        "model": "rizzo-spark-x2.5-4b-q8",
        "answers": {
            "action_X": {"type": "noul", "noul": 0.9},
            "action_Y": {"type": "noul", "noul": 0.1},
            "action_Z": {"type": "noul", "noul": 0.05},
            "expected_outcome": {
                "type": "score",
                "score": 2.0,
                "legend": {"0": "fail", "1": "uncertain", "2": "succeed"},
                "probabilities": {"0": 0.1, "1": 0.2, "2": 0.7},
                "confidence": 0.6,
            },
        },
        "usage": {"input_tokens": 100, "output_tokens": 0},
    }


def test_null_backend_uniform():
    backend = NullBackend()
    out = backend.decide("s", "c", ["X", "Y"], [])
    assert out["action_probabilities"] == {"X": 0.5, "Y": 0.5}


def test_jev_decision_model_with_mock_transport():
    """Full wire simulation: verifies the request shape the adapter sends and
    how the typed answers flow into a structured Decision — without a server."""
    from unittest import mock

    import jev_agent.llm as llm_mod

    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["payload"] = json
        resp = mock.Mock()
        resp.raise_for_status = lambda: None
        resp.json = lambda: _fake_response_payload(["X", "Y", "Z"])
        return resp

    backend = llm_mod.RizzoFlowBackend("http://127.0.0.1:8017")
    with mock.patch.object(llm_mod.httpx, "post", side_effect=fake_post):
        model = JevDecisionModel(backend)
        state = AgentState(goals=["maximize reward"])
        obs = Observation.now(text="signal A", structured={"cue": "A"})
        mems = [MemoryItem(id="m1", content="signal A -> action X reward=5.00")]
        decision = model.decide(state, obs, mems, ["X", "Y", "Z"])

    # request shape: Jev-compatible fan-out, one call, all questions at once
    assert captured["url"].endswith("/v1/systemone")
    payload = captured["payload"]
    expected_questions = {"action_X", "action_Y", "action_Z", "expected_outcome"}
    assert set(payload["questions"]) == expected_questions
    assert payload["questions"]["action_X"]["type"] == "noul"
    assert payload["model"] == "rizzo-latest"
    assert "signal A" in payload["state"]
    # response: typed, structured, no text generation
    d = decision.to_dict()
    assert d["action"] in ("X", "Y", "Z")  # never outside the option set
    assert 0.0 <= d["confidence"] <= 1.0
    assert json.dumps(d)  # serializable structured output
    assert d["memory_dependencies"] == ["m1"]


def test_heuristic_model_uses_memories():
    model = HeuristicDecisionModel()
    state = AgentState(goals=["maximize reward"])
    obs = Observation.now(text="signal A")
    mems = [MemoryItem(id="m1", content="signal A -> action X reward=5.00")]
    decision = model.decide(state, obs, mems, ["X", "Y", "Z"])
    assert decision.action == "X"
    assert decision.probabilities["X"] > decision.probabilities["Y"]
