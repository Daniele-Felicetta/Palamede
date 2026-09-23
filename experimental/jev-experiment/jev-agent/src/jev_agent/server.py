"""Local web UI for jev-agent: run the agent and watch it think.

Zero extra dependencies: a small stdlib HTTP server serves a single-page
instrument panel and exposes the simulation as JSON.

    python -m jev_agent.server            # http://127.0.0.1:8018
    python -m jev_agent.server --port 9000 --no-browser
"""

from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import load_config
from .simulate import DEFAULT_FLAGS, flag_profiles, run_simulation

WEB_DIR = Path(__file__).resolve().parent / "web"
DEFAULT_PORT = 8018


def _resolve_config(path: str | None) -> dict:
    if path:
        return load_config(path)
    local = Path("config.toml")
    if local.exists():
        return load_config(local)
    return load_config(None)


def _health(server_url: str) -> dict:
    """Is a rizzo-flow server reachable? Reported in the UI header."""
    try:
        import httpx

        resp = httpx.get(f"{server_url.rstrip('/')}/v1/models", timeout=1.5)
        resp.raise_for_status()
        return {"up": True, "models": resp.json()}
    except Exception as exc:  # noqa: BLE001 - any failure means "not available"
        return {"up": False, "error": str(exc)}


def make_handler(config: dict):
    server_url = config.get("server_url", "http://127.0.0.1:8017")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quieter default logging
            pass

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict) -> None:
            self._send(
                status,
                json.dumps(payload).encode("utf-8"),
                "application/json; charset=utf-8",
            )

        def do_GET(self) -> None:
            if self.path in ("/", "/index.html"):
                page = (WEB_DIR / "index.html").read_bytes()
                self._send(200, page, "text/html; charset=utf-8")
            elif self.path == "/api/config":
                self._json(
                    200,
                    {
                        "defaults": {
                            "seed": config.get("seed", 0),
                            "steps": config.get("steps", 400),
                            "backend": config.get("backend", "heuristic"),
                            "server_url": server_url,
                        },
                        "flags": DEFAULT_FLAGS,
                        "profiles": flag_profiles(),
                        "actions": ["X", "Y", "Z"],
                        "max_reward": config.get("max_reward", 5.0),
                        "phases": [
                            {"name": "learn", "from": 0, "to": 200},
                            {"name": "drift", "from": 200, "to": 260},
                            {"name": "conflict", "from": 260, "to": 290},
                            {"name": "decay", "from": 290, "to": 400},
                        ],
                    },
                )
            elif self.path == "/api/health":
                self._json(200, {"rizzo": _health(server_url)})
            elif self.path == "/favicon.ico":
                self._send(204, b"", "image/x-icon")
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path != "/api/simulate":
                self._json(404, {"error": "not found"})
                return
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError as exc:
                self._json(400, {"error": f"invalid JSON: {exc}"})
                return

            backend = body.get("backend", "heuristic")
            seed = int(body.get("seed", 0))
            steps = body.get("steps")
            steps = int(steps) if steps is not None else None
            flags = body.get("flags")
            if flags is not None:
                flags = {k: bool(flags.get(k, DEFAULT_FLAGS[k])) for k in DEFAULT_FLAGS}

            try:
                result = run_simulation(
                    config,
                    seed=seed,
                    steps=steps,
                    flags=flags,
                    backend=backend,
                )
            except Exception as exc:  # noqa: BLE001 - surface to the UI
                self._json(502, {"error": f"simulation failed: {exc}"})
                return
            self._json(200, result)

    return Handler


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--config", default=None, help="path to config.toml")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    config = _resolve_config(args.config)
    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(config))
    url = f"http://{args.host}:{args.port}/"
    print(f"jev-agent UI on {url}  (Ctrl+C to stop)")
    print(f"rizzo-flow backend expected at {config.get('server_url')}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
