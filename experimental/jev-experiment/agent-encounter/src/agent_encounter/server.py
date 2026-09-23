"""Local HTTP server for the game. Threaded so status polling works while the
single inference thread is busy; no handler thread ever touches MLX.
"""

from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .decisions import RizzoDecisions
from .dialogs import SparkDialogs
from .game import Game
from .hub import InferenceHub

WEB_DIR = Path(__file__).resolve().parent / "web"
DEFAULT_PORT = 8019


def make_handler(game: Game, hub: InferenceHub | None):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # keep the console readable
            pass

        # -- plumbing ---------------------------------------------------
        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict) -> None:
            self._send(
                status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8"
            )

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            return json.loads(raw or b"{}")

        def _handle(self, fn) -> None:
            try:
                status, payload = fn()
            except KeyError as exc:
                status, payload = 404, {"error": str(exc)}
            except ValueError as exc:
                status, payload = 400, {"error": str(exc)}
            except json.JSONDecodeError as exc:
                status, payload = 400, {"error": f"JSON non valido: {exc}"}
            except Exception as exc:  # noqa: BLE001 - report instead of killing the server
                status, payload = 500, {"error": f"{type(exc).__name__}: {exc}"}
            self._json(status, payload)

        # -- routes -----------------------------------------------------
        def do_GET(self) -> None:
            if self.path in ("/", "/index.html"):
                page = (WEB_DIR / "index.html").read_bytes()
                self._send(200, page, "text/html; charset=utf-8")
            elif self.path.startswith("/assets/"):
                name = self.path[len("/assets/") :]
                assets = (WEB_DIR / "assets").resolve()
                target = (assets / name).resolve()
                if assets not in target.parents or not target.is_file():
                    self._json(404, {"error": "asset not found"})
                    return
                mime = "image/png" if target.suffix == ".png" else "text/plain; charset=utf-8"
                self._send(200, target.read_bytes(), mime)
            elif self.path == "/api/state":
                payload = game.snapshot()
                payload["status"] = hub.status() if hub else {"state": "ready", "detail": "finto"}
                self._json(200, payload)
            elif self.path == "/api/status":
                self._json(
                    200,
                    {
                        "model": hub.status() if hub else {"state": "ready", "detail": "finto"},
                        "mode": game.mode,
                        "error": game.last_error,
                    },
                )
            elif self.path == "/favicon.ico":
                self._send(204, b"", "image/x-icon")
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path == "/api/reset":
                self._handle(lambda: (200, game.reset()))
            elif self.path == "/api/move":
                def move():
                    body = self._body()
                    return 200, game.move(int(body.get("dx", 0)), int(body.get("dy", 0)))

                self._handle(move)
            elif self.path == "/api/encounter":
                def encounter():
                    body = self._body()
                    return 200, game.encounter(str(body["npc_id"]))

                self._handle(encounter)
            elif self.path == "/api/decline":
                def decline():
                    body = self._body()
                    return 200, game.decline(str(body["npc_id"]))

                self._handle(decline)
            elif self.path == "/api/talk":
                def talk():
                    body = self._body()
                    return 200, game.talk(str(body["npc_id"]), str(body.get("line", "")))

                self._handle(talk)
            elif self.path == "/api/actions":
                def actions():
                    body = self._body()
                    return 200, game.actions(str(body["npc_id"]))

                self._handle(actions)
            elif self.path == "/api/resolve":
                def resolve():
                    body = self._body()
                    return 200, game.resolve(str(body["npc_id"]), str(body["action"]))

                self._handle(resolve)
            else:
                self._json(404, {"error": "not found"})

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model", default=None, help="checkpoint directory")
    parser.add_argument("--bits", type=int, choices=(4, 8), default=8)
    parser.add_argument("--device", default="auto", help="auto | gpu | mlx | cuda | cpu")
    parser.add_argument("--no-prewarm", action="store_true", help="load the model on first use")
    parser.add_argument("--fake", action="store_true", help="no model: offline stand-ins only")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    hub = None
    if args.fake:
        from .decisions import LocalDecisions
        from .dialogs import LocalDialogs

        game = Game(LocalDecisions(), LocalDialogs())
    else:
        hub = InferenceHub(
            model_path=args.model,
            bits=args.bits,
            device=args.device,
            prewarm=not args.no_prewarm,
        )
        game = Game(RizzoDecisions(hub), SparkDialogs(hub))

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(game, hub))
    url = f"http://{args.host}:{args.port}/"
    print(f"agent-encounter su {url}  (Ctrl+C per fermare)")
    if hub is None:
        print("modalità --fake: nessun modello, decisioni e dialoghi locali")
    else:
        print(f"checkpoint: {hub.model_path}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nfermato")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
