"""End-to-end game flow with fake backends: no model, no network."""

from __future__ import annotations

import pytest

from agent_encounter import world
from agent_encounter.decisions import Decision
from agent_encounter.game import Game


class FakeDecisions:
    def __init__(self, engage=True, attitude=4.0, action="ask_rumor"):
        self.engage_value = engage
        self.attitude_value = attitude
        self.action_value = action
        self.source = "rizzo"

    def _d(self, question, kind, probabilities, legend, value, suggestion):
        return Decision(question, kind, "ok", probabilities, legend, value, suggestion, "rizzo")

    def engage(self, npc, session):
        value = self.engage_value
        return self._d(
            "engage", "boolean", {"true": 0.8, "false": 0.2}, {}, value,
            "true" if value else "false",
        )

    def attitude(self, npc, session, player_line, npc_line):
        return self._d(
            "attitude", "score", {str(i): 0.1 for i in range(5)}, {}, self.attitude_value,
            str(int(self.attitude_value)),
        )

    def action(self, npc, session):
        options = {action: 0.5 for action in [self.action_value, "leave"]}
        return self._d("action", "choice", options, {}, self.action_value, self.action_value)


class FakeDialogs:
    def __init__(self):
        self.calls = []

    def reply(self, npc, session, player_line):
        self.calls.append(player_line)
        return f"{npc['name']} ti risponde in una frase."


class BoomDecisions(FakeDecisions):
    def engage(self, npc, session):
        raise RuntimeError("model down")

    def attitude(self, npc, session, player_line, npc_line):
        raise RuntimeError("model down")

    def action(self, npc, session):
        raise RuntimeError("model down")


class BoomDialogs(FakeDialogs):
    def reply(self, npc, session, player_line):
        raise RuntimeError("model down")


def make_game(**kwargs):
    return Game(FakeDecisions(**kwargs), FakeDialogs())


def test_encounter_returns_probabilistic_decision():
    game = make_game()
    result = game.encounter("pino")
    assert result["decision"]["question"] == "engage"
    assert abs(sum(result["decision"]["probabilities"].values()) - 1) < 1e-9
    assert result["npc"]["name"] == "Pino"


def test_talk_generates_line_and_moves_relationship():
    game = make_game(attitude=4.0)
    before = game.session.npc("pino").relationship
    result = game.talk("pino", "Ciao Pino!")
    assert "Pino" in result["line"]
    assert result["npc"]["relationship"] > before
    assert game.session.npc("pino").talks == 1
    assert game.session.npc("pino").history[-1]["content"] == result["line"]


def test_rumor_reveals_cache_and_stepping_on_it_pays():
    game = make_game(action="ask_rumor")
    assert game.actions("pino")["decision"]["suggestion"] == "ask_rumor"
    resolved = game.resolve("pino", "ask_rumor")
    assert resolved["cache"]["revealed"] is True

    player = game.session.player
    player.x, player.y = world.CACHE_POS[0] - 1, world.CACHE_POS[1]
    gold_before = player.gold
    game.move(1, 0)
    assert game.session.cache_taken is True
    assert player.gold == gold_before + 15


def test_give_potion_spends_item_and_raises_relationship():
    game = make_game()
    before = game.session.npc("pino").relationship
    game.resolve("pino", "give_potion")
    assert game.session.player.items["pozione"] == 1
    assert game.session.npc("pino").relationship > before


def test_unavailable_action_is_rejected():
    game = make_game()
    with pytest.raises(ValueError):
        game.resolve("nissa", "ask_rumor")  # Nissa knows no secret


def test_movement_is_blocked_by_walls_and_agents():
    game = make_game()
    game.session.player.x, game.session.player.y = 1, 1
    assert game.move(-1, 0)["moved"] is False  # into the border
    nissa = world.npc_by_id("nissa")
    game.session.player.x, game.session.player.y = nissa["pos"][0] - 1, nissa["pos"][1]
    assert game.move(1, 0)["moved"] is False  # into the agent


def test_backends_fall_back_to_local_when_model_fails():
    game = Game(BoomDecisions(), BoomDialogs())
    result = game.encounter("pino")
    assert result["mode"] == "local"
    assert game.last_error
    line = game.talk("pino", "Ciao")["line"]
    assert isinstance(line, str) and line


def test_adjacent_npc_detection():
    game = make_game()
    pino = world.npc_by_id("pino")
    game.session.player.x, game.session.player.y = pino["pos"][0], pino["pos"][1] + 1
    assert game.adjacent_npc()["id"] == "pino"
    game.session.player.x, game.session.player.y = 9, 6
    assert game.adjacent_npc() is None
