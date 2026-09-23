"""HTTP surface of the game server, exercised with fake backends (no model)."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from agent_encounter.decisions import LocalDecisions
from agent_encounter.dialogs import LocalDialogs
from agent_encounter.game import Game
from agent_encounter.server import make_handler


def _serve():
    game = Game(LocalDecisions(), LocalDialogs())
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(game, None))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def _post(base, path, payload):
    request = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(request).read())


def test_page_and_state():
    httpd, base = _serve()
    try:
        page = urllib.request.urlopen(base + "/").read()
        assert b"agent-encounter" in page
        state = json.loads(urllib.request.urlopen(base + "/api/state").read())
        assert state["map"]["w"] == 60 and len(state["npcs"]) == 5
        assert len(state["map"]["ground"]) == state["map"]["h"]
        assert "status" in state
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_full_encounter_over_http():
    httpd, base = _serve()
    try:
        encounter = _post(base, "/api/encounter", {"npc_id": "pino"})
        assert encounter["decision"]["question"] == "engage"

        talk = _post(base, "/api/talk", {"npc_id": "pino", "line": "Ciao!"})
        assert talk["line"]

        actions = _post(base, "/api/actions", {"npc_id": "pino"})
        assert actions["decision"]["question"] == "action"

        resolved = _post(base, "/api/resolve", {"npc_id": "pino", "action": "ask_rumor"})
        assert resolved["cache"]["revealed"] is True
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_unknown_agent_is_404_and_bad_action_is_400():
    httpd, base = _serve()
    try:
        try:
            _post(base, "/api/encounter", {"npc_id": "nessuno"})
            raise AssertionError("expected 404")
        except urllib.error.HTTPError as exc:
            assert exc.code == 404
        try:
            _post(base, "/api/resolve", {"npc_id": "nissa", "action": "ask_rumor"})
            raise AssertionError("expected 400")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
    finally:
        httpd.shutdown()
        httpd.server_close()
