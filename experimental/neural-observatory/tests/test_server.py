"""Palamede — Osservatorio: test end-to-end del server (REST + stream SSE).

Alza il server vero sulla porta indicata, fa un update vero e verifica che
gli eventi arrivino al client nell'ordine e con i dati giusti. Poi lo spegne.

  python experimental/neural-observatory/tests/test_server.py
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OBS = ROOT / "experimental" / "neural-observatory"
PY = ROOT / "reference" / "trellis-venv" / "Scripts" / "python.exe"
PORT = 8131
BASE = f"http://127.0.0.1:{PORT}"

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'ok' if ok else 'FAIL'}]   {name}  {detail}", flush=True)


def free(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) != 0


def get(path: str, timeout: float = 60.0):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as r:
        return json.loads(r.read())


def post(path: str, body: dict | None = None, timeout: float = 240.0):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def wait_up(timeout: float = 90.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if get("/api/health", timeout=3).get("ok"):
                return True
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    return False


class SSEStream:
    """Lettore SSE minimo: apre lo stream e restituisce gli eventi uno a uno.

    Il frontend usa `EventSource` (nativo nel browser); qui si fa a mano
    perche' il venv non ha librerie Web e non se ne possono installare.
    """

    def __init__(self, url: str, timeout: float = 300.0):
        req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
        self.resp = urllib.request.urlopen(req, timeout=timeout)
        ct = self.resp.headers.get("Content-Type", "")
        if "text/event-stream" not in ct:
            raise AssertionError(f"content-type non SSE: {ct}")
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
                ev: dict = {"id": None, "event": None, "data": {}}
                for ln in lines:
                    key, _, val = ln.partition(":")
                    val = val.strip()
                    if key == "data":
                        ev["data"] = json.loads(val)
                    elif key in ("id", "event"):
                        ev[key] = val
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
    if not PY.exists():
        print(f"venv mancante: {PY}")
        return 1
    if not free(PORT):
        print(f"porta {PORT} gia' occupata: libera lo o cambia OBS_PORT")
        return 1

    proc = subprocess.Popen(  # noqa: S603
        [str(PY), "-m", "backend.server"], cwd=str(OBS),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace",
    )
    try:
        print("=== 1. AVVIO ===")
        t0 = time.time()
        up = wait_up()
        check("server su :8131", up, f"{time.time()-t0:.1f}s")
        if not up:
            print(proc.stdout.read()[-3000:] if proc.stdout else "")
            return 1

        h = get("/api/health")
        check("health risponde", h.get("ok") is True, h["service"])
        g = get("/api/metrics")["gpu"]
        check("GPU vista dal backend", g["available"] is True,
              f"{g['name']} {g['total_mib']:.0f} MiB bf16={g['bf16']}")

        print("\n=== 2. STATO INIZIALE ===")
        st = get("/api/health")["state"]
        check("modello non caricato all'avvio", st["loaded"] is False, f"phase={st['phase']}")
        code, r = post("/api/train", {"prompt": "a", "target": "b"})
        check("rifiuta il training senza modello", code == 409, f"HTTP {code}: {r.get('error')}")

        print("\n=== 3. CARICAMENTO ===")
        t0 = time.time()
        code, r = post("/api/load")
        ms = (time.time() - t0) * 1000
        check("carica LFM2.5 230M", code == 200 and r.get("ok"), f"{ms:.0f}ms via HTTP")
        if code != 200:
            print(r)
            return 1
        info = r["model"]
        check("parametri giusti", info["total_params"] == 229_693_184,
              f"{info['total_params']:,} param su {info['device']}, dtype master {info['master_dtype']}")
        check("warmup eseguito", info.get("warmup", {}).get("generate_ms", 0) > 0,
              f"prima generazione {info['warmup']['generate_ms']}ms invece di ~13600ms")

        gr = get("/api/graph")
        check("grafo 3D esposto", len(gr["nodes"]) == 16 and len(gr["modules"]) == 130,
              f"{len(gr['nodes'])} nodi, {len(gr['modules'])} moduli, "
              f"{len(gr['links'])} collegamenti")
        check("iperparametri dichiarati", not gr["unclassified"],
              "nessun parametro non classificato")

        print("\n=== 4. STREAM SSE ===")
        stream = SSEStream(f"{BASE}/api/stream")
        try:
            first = next(stream)
            check("primo evento e' un hello", first["event"] == "hello",
                  f"id={first['id']}, config={len(first['data']['config'])} chiavi, "
                  f"legenda={len(first['data']['legend'])} voci")
            hello = first["data"]
            check("legenda dichiara i mapping", all(
                {"channel", "measures", "scale"} <= set(x) for x in hello["legend"]),
                "ogni canale visivo dice cosa misura")
            check("disclaimer presente", "neurone" in hello["disclaimer"],
                  "dichiara che i nodi sono gruppi di tensori")

            post("/api/train", {"prompt": "Il gatto dorme sul", "target": " tappeto", "steps": 2})
            events: list[dict] = []
            for ev in stream:
                events.append(ev)
                if ev["event"] == "update_end":
                    break
        finally:
            stream.close()

        kinds = [e["event"] for e in events]
        # il backend emette anche `status` (cambio di fase): non e' un errore,
        # e' il canale che dice alla UI "adesso sto allenando".
        ciclo = [k for k in kinds if k in ("update_start", "step", "update_end")]
        check("sequenza eventi corretta",
              ciclo == ["update_start", "step", "step", "update_end"],
              " -> ".join(kinds))
        ids = [int(e["id"]) for e in events if e["id"]]
        check("id SSE monotoni", ids == sorted(ids) and len(ids) == len(set(ids)),
              f"{ids}")

        us = next(e["data"] for e in events if e["event"] == "update_start")
        check("update_start porta BEFORE", us["loss_before"] > 0 and us["output_before"] != "",
              f"loss {us['loss_before']:.4f}, output {us['output_before'][:40]!r}")
        check("token reali", len(us["tokens"]) == len(us["token_ids"]) and us["n_target"] > 0,
              f"{len(us['tokens'])} token, {us['n_target']} sul target")

        st1 = next(e["data"] for e in events if e["event"] == "step")
        check("step porta gradiente per layer", len(st1["layers"]) >= 14,
              f"{len(st1['layers'])} nodi, gradiente globale {st1['grad_norm_global']:.4f}")
        check("step porta tempi reali",
              all(st1["timing"][k] > 0 for k in ("forward_ms", "backward_ms", "optimizer_ms")),
              f"fwd {st1['timing']['forward_ms']}ms bwd {st1['timing']['backward_ms']}ms "
              f"opt {st1['timing']['optimizer_ms']}ms analisi {st1['timing']['analyze_ms']}ms")

        ue = next(e["data"] for e in events if e["event"] == "update_end")
        check("update_end ha BEFORE e AFTER",
              ue["loss_after"] < ue["loss_before"] and "output_after" in ue,
              f"loss {ue['loss_before']:.4f} -> {ue['loss_after']:.4f}")
        check("update_end ha 132 tensori misurati", len(ue["tensors"]) == 132,
              f"{ue['totals']['changed_tensors']}/{ue['totals']['tensors']} cambiati, "
              f"delta-norm {ue['totals']['delta_norm']:.4f}")
        check("aggregazione per layer coerente",
              abs(sum(x["contribution_pct"] for x in ue["layers"] if not x["aliased"]) - 100) < 1e-6,
              "15 gruppi reali, quote = 100%")
        check("attivazioni reali per layer", len(ue["activations"]) == 14,
              f"ultimo hidden RMS {ue['activations']['13']['rms']:.3f}")
        check("attenzione reale", len(ue["attention"].get("layers", {})) == 6,
              ue["attention"].get("reduction", "?"))
        check("token view per-token", ue["per_token"] and len(ue["per_token"]["rows"]) == len(ue["tokens"]),
              f"{len(ue['per_token']['rows'])} token con norm+entropia")
        check("nota di precisione presente", "arrotondamento" in ue["precision_note"],
              ue["precision_note"][:70])
        check("VRAM riportata", ue["vram"]["max_allocated_mib"] > 0,
              f"picco {ue['vram']['max_allocated_mib']:.0f} MiB")

        print("\n=== 5. STORIA E CONFRONTO ===")
        hst = get("/api/history")["history"]
        check("cronologia via REST", len(hst) == 1 and hst[0]["index"] == 0,
              f"{len(hst)} voci, delta-norm {hst[0]['delta_norm']:.4f}")
        post("/api/train", {"prompt": "La capitale d'Italia e'", "target": " Roma", "steps": 1})
        code, cmp_ = post("/api/compare", {"a": 0, "b": 1})
        check("confronto update A vs B", code == 200 and len(cmp_["layers"]) == 16,
              f"guadagno A {cmp_['loss']['gain_a']:.3f} vs B {cmp_['loss']['gain_b']:.3f}")
        check("confronto dichiara la distanza mancante",
              cmp_["exact_weight_distance"] is None and "weight_snapshot_keep" in cmp_["exact_weight_distance_note"],
              "distanza parametrica non calcolata e perche'")

        print("\n=== 6. MODALITA' LoRA ===")
        code, r = post("/api/config", {"mode": "LORA", "lora": {"rank": 8, "alpha": 32}})
        check("switch FULL -> LORA", code == 200 and r["config"]["mode"] == "LORA",
              f"rank {r['config']['lora']['rank']}")
        st = get("/api/health")["state"]
        check("stato dopo lo switch", st["loaded"] is True, f"phase={st['phase']}")
        strm = SSEStream(f"{BASE}/api/stream")
        try:
            h2 = next(strm)["data"]
        finally:
            strm.close()
        mi = h2.get("mode") or {}
        li = mi.get("lora") or {}
        check("gli adapter sono davvero applicati",
              li.get("adapters", 0) > 0 and li.get("base_frozen") is True
              and mi.get("trainable_params", 0) < mi.get("frozen_params", 0) * 0 + 1e12
              and mi.get("trainable_params", 0) < 5_000_000,
              f"{li.get('adapters')} adapter, {mi.get('trainable_params'):,} trainabili, "
              f"{mi.get('frozen_params'):,} congelati, base_frozen={li.get('base_frozen')}")
        check("i 16 nodi restano nella aggregazione",
              len(h2["graph"]["nodes"]) == 16, f"{len(h2['graph']['nodes'])} nodi")

        code, r = post("/api/train", {"prompt": "Il cane", "target": " abbaia", "steps": 1})
        if code == 200:
            u = r["update"]
            moved = [t for t in u["tensors"] if t["changed"]]
            lora_only = bool(moved) and all(".lora_" in t["name"] for t in moved)
            frozen_row = [x for x in u["layers"] if x["id"] == "embeddings"]
            check("solo gli adapter si muovono", lora_only and u["loss_after"] < u["loss_before"],
                  f"{len(moved)}/{len(u['tensors'])} tensori cambiati, tutti adapter; "
                  f"loss {u['loss_before']:.4f} -> {u['loss_after']:.4f}")
            check("embeddings congelate dichiarate, non sparite",
                  bool(frozen_row) and frozen_row[0]["measured"] is False
                  and frozen_row[0]["delta_norm"] == 0.0,
                  " Riga presente con measured=false e delta 0")
            check("16 righe di layer anche se 2 sono congelate",
                  len(u["layers"]) == 16, f"{len(u['layers'])} righe")
        else:
            check("solo gli adapter si muovono", False, str(r)[:160])

        print("\n=== 7. RESET ===")
        code, r = post("/api/reset-model", timeout=300)
        m = r.get("model", {})
        # il reset riporta ai pesi su disco; se siamo ancora in LoRA il
        # conteggio comprende gli adapter, quindi il numero da confrontare e'
        # `base_params`, non `total_params`.
        check("reset ai pesi originali", code == 200 and m.get("base_params") == 229_693_184,
              f"HTTP {code}: base={m.get('base_params'):,} adapter={m.get('adapter_params'):,} "
              f"caricati in {m.get('load_ms')}ms")
        code, r = post("/api/config", {"mode": "FULL"})
        check("torna a FULL", code == 200 and r["config"]["mode"] == "FULL", "")

        print("\n" + "=" * 74)
        ok = sum(1 for _, p, _ in RESULTS if p)
        bad = [n for n, p, _ in RESULTS if not p]
        print(f"RISULTATO: {ok}/{len(RESULTS)} verifiche passate")
        for n in bad:
            print("  -", n)
        return 1 if bad else 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
        out = proc.stdout.read() if proc.stdout else ""
        tail = [ln for ln in out.splitlines() if ln.strip()][-6:]
        if tail:
            print("\n--- log server (ultime righe) ---")
            for ln in tail:
                print("   ", ln)


if __name__ == "__main__":
    raise SystemExit(main())
