"""End-to-end test of the local UI server (no model, no browser)."""

from __future__ import annotations

import json
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.config import load_config
from jev_agent.server import make_handler


def _serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(load_config(None)))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def test_server_serves_page_config_and_simulation():
    httpd, base = _serve()
    try:
        page = urllib.request.urlopen(base + "/").read()
        assert b"jev" in page and b"Nastro delle decisioni" in page

        cfg = json.loads(urllib.request.urlopen(base + "/api/config").read())
        assert cfg["actions"] == ["X", "Y", "Z"]
        assert "full_memory" in cfg["profiles"]

        payload = json.dumps(
            {"backend": "heuristic", "seed": 2, "steps": 25, "flags": cfg["flags"]}
        ).encode()
        req = urllib.request.Request(
            base + "/api/simulate", data=payload, headers={"Content-Type": "application/json"}
        )
        result = json.loads(urllib.request.urlopen(req).read())
        assert len(result["trace"]) == 25
        assert len(result["memories"]) > 0
        first = result["trace"][0]
        assert set(first["probabilities"]) == {"X", "Y", "Z"}
        assert "retrieved_ids" in first
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_rejects_bad_json():
    httpd, base = _serve()
    try:
        req = urllib.request.Request(
            base + "/api/simulate", data=b"not json", headers={"Content-Type": "application/json"}
        )
        try:
            urllib.request.urlopen(req)
            raise AssertionError("expected HTTP 400")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
    finally:
        httpd.shutdown()
        httpd.server_close()
