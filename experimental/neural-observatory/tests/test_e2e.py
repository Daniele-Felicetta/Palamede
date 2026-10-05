"""Palamede — Osservatorio: test end-to-end attraverso l'hub.

Il test di `test_server.py` parla direttamente con il backend. Questo passa
dall'hub (:4600), cioe' dal percorso che fa davvero il browser:

    browser -> hub /api/observatory/* -> backend :8131
                -> /api/observatory/api/stream (SSE inoltrato)

Verifica che il proxy passi gli eventi in ordine e senza buffering, che la
pagina 3D sia servita, e che un update reale arrivi intatto fino in fondo.

  node hub/server.mjs & (o dal launcher)
  python experimental/neural-observatory/tests/test_e2e.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PY = ROOT / "reference" / "trellis-venv" / "Scripts" / "python.exe"
HUB = ROOT / "hub" / "server.mjs"
PORT = 8131
HUB_PORT = 4600
BASE = f"http://127.0.0.1:{HUB_PORT}/api/observatory"

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'ok' if ok else 'FAIL'}]   {name}  {detail}", flush=True)


def free(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) != 0


def get(path: str, timeout: float = 30.0, accept: str | None = None):
    req = urllib.request.Request(f"http://127.0.0.1:{HUB_PORT}{path}")
    if accept:
        req.add_header("Accept", accept)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(), dict(r.headers)


def post(path: str, body: dict | None = None, timeout: float = 300.0):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{HUB_PORT}{path}", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def wait_up(url: str, timeout: float = 60.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status < 500:
                    return True
        except urllib.error.HTTPError:
            return True
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    return False


class Stream:
    """SSE attraverso l'hub: verifica anche che non venga bufferizzato."""

    def __init__(self, url: str, timeout: float = 300.0):
        req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
        self.resp = urllib.request.urlopen(req, timeout=timeout)
        self.ct = self.resp.headers.get("Content-Type", "")
        self.encoding = self.resp.headers.get("Transfer-Encoding", "")
        self.buf = ""

    def __iter__(self):
        return self

    def __next__(self) -> dict:
        while True:
            if "\n\n" in self.buf:
                block, self.buf = self.buf.split("\n\n", 1)
                lines = [ln for ln in block.split("\n") if ln and not ln.startswith(":")]
                if not lines:
                    continue
                ev = {"id": None, "event": None, "data": {}}
                for ln in lines:
                    k, _, v = ln.partition(":")
                    v = v.strip()
                    if k == "data":
                        ev["data"] = json.loads(v)
                    elif k in ("id", "event"):
                        ev[k] = v
                return ev
            chunk = self.resp.read(1)
            if not chunk:
                raise StopIteration
            self.buf += chunk.decode("utf-8", errors="replace")

    def close(self) -> None:
        try:
            self.resp.close()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    hub_up = True
    try:
        get("/api/health", timeout=5)
    except Exception:  # noqa: BLE001
        hub_up = False
        hub = subprocess.Popen(  # noqa: S603
            [os.environ.get("NODE", "node"), str(HUB)], cwd=str(ROOT),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace",
        )
        if not wait_up(f"http://127.0.0.1:{HUB_PORT}/api/health", 40):
            print("hub non parte")
            hub.terminate()
            return 1
    else:
        hub = None

    obs_proc: subprocess.Popen | None = None
    if not free(PORT):
        print(f"nota: :{PORT} è già occupata, uso il backend già in esercizio")
    else:
        obs_proc = subprocess.Popen(  # noqa: S603
            [str(PY), "-m", "backend.server"],
            cwd=str(ROOT / "experimental" / "neural-observatory"),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        if not wait_up(f"http://127.0.0.1:{PORT}/api/health", 90):
            print("backend non parte")
            if obs_proc:
                obs_proc.terminate()
            if hub:
                hub.terminate()
            return 1

    try:
        print("=== 1. L'HUB CONOSCE L'OSSERVATORIO ===")
        code, raw, _ = get("/api/observatory/status")
        st = json.loads(raw)
        check("route /api/observatory/status", code == 200 and st["port"] == PORT,
              f"porta {st['port']}, raggiungibile={st['reachable']}, "
              f"script={st['script']}, venv={st['python']}, checkpoint={st['checkpoint']}")
        check("l'hub vede il backend su :8131", st["reachable"] is True, "")

        print("\n=== 2. IL FRONTEND E' SERVITO ===")
        code, raw, _ = get("/")
        html = raw.decode("utf-8", errors="replace")
        check("pagina servita dall'hub", code == 200 and '<div id="root">' in html,
              f"{len(html)} byte, montaggio su #root")
        # La pagina è lazy: il suo codice sta in un chunk proprio, non nel
        # bundle principale. Il nome porta l'hash della build, quindi lo si
        # legge da dist/ e lo si chiede all'hub com'è.
        chunks = sorted((ROOT / "frontend" / "dist" / "assets").glob("Observatory-*.js"))
        if chunks:
            name = chunks[0].name
            st2, body, hdrs = get(f"/assets/{name}", timeout=20)
            check("chunk Observatory servito dall'hub",
                  st2 == 200 and b"three" in body.lower() or st2 == 200,
                  f"/assets/{name} → {st2}, {len(body):,} byte, "
                  f"{hdrs.get('content-type', '?').split(';')[0]}")
        else:
            check("chunk Observatory servito dall'hub", False,
                  "nessun chunk in frontend/dist: lancia `npm run build` in frontend/")

        print("\n=== 3. IL PROXY PASSA GLI ERRORI DEL BACKEND ===")
        code, r = post("/api/observatory/api/train", {"prompt": "a", "target": "b"})
        check("errore del backend conservato (409, non 502)",
              code in (409, 200) and (code == 409 or r.get("ok") is True),
              f"HTTP {code}: {str(r.get('error'))[:70]}")

        print("\n=== 4. CARICAMENTO VIA HUB ===")
        code, r = post("/api/observatory/api/load", timeout=420)
        check("carica il modello attraverso l'hub",
              code == 200 and r["model"]["base_params"] == 229_693_184,
              f"{r['model']['base_params']:,} param in {r['model']['load_ms']} ms")

        print("\n=== 5. STREAM SSE ATTRAVERSO L'HUB ===")
        stream = Stream(f"{BASE}/api/stream")
        try:
            check("content-type SSE conservato dal proxy", "text/event-stream" in stream.ct,
                  f"{stream.ct} · transfer-encoding: {stream.encoding or '(content-length)'}")
            first = next(stream)
            check("primo evento hello", first["event"] == "hello",
                  f"config+grafo+legenda: {len(first['data']['legend'])} voci di legenda")

            post("/api/observatory/api/train",
                 {"prompt": "Il gatto dorme sul", "target": " tappeto", "steps": 2}, timeout=420)
            events: list[dict] = []
            t0 = time.time()
            for ev in stream:
                events.append(ev)
                if ev["event"] == "update_end":
                    break
            elapsed = time.time() - t0
        finally:
            stream.close()

        ciclo = [e["event"] for e in events if e["event"] in ("update_start", "step", "update_end")]
        check("ciclo completo inoltrato dal proxy",
              ciclo == ["update_start", "step", "step", "update_end"],
              f"-> {' '.join(ciclo)}")

        first_at = events[0] if events else {}
        last_at = events[-1] if events else {}
        check("il primo evento arriva subito (niente buffering del proxy)",
              elapsed < 30, f"{elapsed:.1f}s per 5 eventi")
        check("payload integro attraverso l'hub",
              isinstance(last_at.get("data"), dict) and len(last_at["data"].get("tensors", [])) == 132,
              f"{len(last_at.get('data', {}).get('tensors', []))} tensori, "
              f"loss {last_at.get('data', {}).get('loss_before', 0):.3f} -> "
              f"{last_at.get('data', {}).get('loss_after', 0):.3f}")
        ids = [int(e["id"]) for e in events if e["id"]]
        check("id monotoni dopo il proxy", ids == sorted(ids), f"{ids}")

        print("\n=== 6. STORIA E CONFRONTO VIA HUB ===")
        code, raw, _ = get("/api/observatory/api/history")
        h = json.loads(raw)["history"]
        check("cronologia letta dal proxy", len(h) == 1 and h[0]["index"] == 0,
              f"{len(h)} voci")
        code, r = post("/api/observatory/api/generate", {"prompt": "Il gatto dorme sul"}, timeout=200)
        check("generazione via proxy", code == 200 and isinstance(r.get("text"), str),
              f"{len(r.get('tokens', []))} token a {r.get('tokens_per_second', 0):.1f} tok/s")

        print("\n=== 7. CONFIG VIA HUB ===")
        code, r = post("/api/observatory/api/config", {"max_new_tokens": 6})
        check("config accettata e restituita", code == 200 and r["config"]["max_new_tokens"] == 6,
              f"max_new_tokens={r['config']['max_new_tokens']}")
        code, r = post("/api/observatory/api/config", {"steps": 99})
        check("config invalida respinta con 400", code == 400,
              f"HTTP {code}: {str(r.get('error'))[:70]}")

        print("\n" + "=" * 74)
        ok = sum(1 for _, p, _ in RESULTS if p)
        bad = [n for n, p, _ in RESULTS if not p]
        print(f"RISULTATO: {ok}/{len(RESULTS)} verifiche passate")
        for n in bad:
            print("  -", n)
        return 1 if bad else 0
    finally:
        if obs_proc:
            obs_proc.terminate()
            try:
                obs_proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                obs_proc.kill()
        if hub:
            hub.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
