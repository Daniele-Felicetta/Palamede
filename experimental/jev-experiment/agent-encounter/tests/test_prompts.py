"""The generated rizzo-flow requests must be valid under rizzo's own schema."""

from __future__ import annotations

import pytest

from agent_encounter import prompts, world
from agent_encounter.state import Session

Request = pytest.importorskip("rizzo_flow.schema").Request


def _npc():
    return world.npc_by_id("pino")


def test_engagement_request_is_valid():
    session = Session()
    state, questions = prompts.engagement_request(_npc(), session)
    request = Request.model_validate({"state": state, "questions": questions})
    assert request.questions["engage"].type == "boolean"
    assert request.questions["engage"].policy.allow_abstain is False


def test_attitude_request_is_valid():
    session = Session()
    state, questions = prompts.attitude_request(_npc(), session, "Ciao!", "Ciao a te.")
    request = Request.model_validate({"state": state, "questions": questions})
    assert request.questions["attitude"].type == "score"


def test_action_request_is_valid_and_options_match_available():
    session = Session()
    npc = _npc()
    state, questions = prompts.action_request(npc, session)
    request = Request.model_validate({"state": state, "questions": questions})
    option_ids = [option.id for option in request.questions["action"].options]
    assert option_ids == prompts.available_actions(npc, session)


def test_state_is_json_serializable_and_bounded():
    import json

    session = Session()
    state, _ = prompts.engagement_request(_npc(), session)
    assert len(json.dumps(state, ensure_ascii=False).encode()) < 256_000


def test_dialog_messages_shape():
    session = Session()
    messages = prompts.dialog_messages(_npc(), session, "Buongiorno!")
    assert messages[0]["role"] == "system"
    assert messages[-1]["role"] == "user"
    assert "Buongiorno!" in messages[-1]["content"]
