"""Fase 5: end-to-end validation of jev-agent with the real rizzo-flow server.

Runs the full agent cycle (perception -> memory retrieval -> Jev-style typed
decision fan-out -> environment outcome -> plasticity/consolidation) against
the live Spark-X2.5-4B backend.
"""

import json
import random
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.agent import Agent
from jev_agent.config import load_config
from jev_agent.decision import JevDecisionModel
from jev_agent.env import AssociationEnvironment
from jev_agent.llm import RizzoFlowBackend
from jev_agent.memory.event_log import EventLog
from jev_agent.memory.sqlite_store import SqliteStore

STEPS = 60
if "--steps" in sys.argv:
    STEPS = int(sys.argv[sys.argv.index("--steps") + 1])

config = load_config("config.toml")
config["backend"] = "jev"
config["steps"] = STEPS

store = SqliteStore(":memory:")
log = EventLog()
agent = Agent(config, JevDecisionModel(RizzoFlowBackend("http://127.0.0.1:8017")), store, log)
env = AssociationEnvironment(config, random.Random(0))

correct = 0
latencies = []
actions = Counter()
for i in range(STEPS):
    t0 = time.perf_counter()
    r = agent.run_step(env)
    latencies.append(time.perf_counter() - t0)
    correct += 1 if r["ok"] else 0
    actions[r["decision"].action] += 1
    if i < 8 or i % 20 == 0:
        probs = {k: round(v, 2) for k, v in r["decision"].probabilities.items()}
        print(
            f"step {i:>3}: cue={env._last_cue:5s} -> {r['decision'].action} "
            f"ok={int(r['ok'])} conf={r['decision'].confidence:.2f} p={probs}"
        )

lat_ms = [l * 1000 for l in latencies]
lat_ms = sorted(lat_ms)
print(f"\ndecision accuracy ({STEPS} steps): {correct / STEPS:.3f}")
print(f"latency ms p50/p95: {lat_ms[len(lat_ms)//2]:.0f} / {lat_ms[int(len(lat_ms)*0.95)]:.0f}")
print(f"actions: {dict(actions)}")
print(f"memory: {agent.memory_stats()}")
print(f"experience log events: {len(log.all())}")

out = Path("results")
out.mkdir(exist_ok=True)
out_file = out / f"jev-full-{STEPS}steps.json"
with out_file.open("x", encoding="utf-8") as fh:
    json.dump(
        {
            "backend": "rizzo-flow rizzo-spark-x2.5-4b-q8",
            "steps": STEPS,
            "accuracy": correct / STEPS,
            "latency_p50_p95_ms": [lat_ms[len(lat_ms) // 2], lat_ms[int(len(lat_ms) * 0.95)]],
            "actions": dict(actions),
            "memory": agent.memory_stats(),
        },
        fh,
        indent=2,
    )
    fh.write("\n")
print("written:", out_file)
