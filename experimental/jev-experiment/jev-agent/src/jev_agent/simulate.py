"""Run one agent episode and return everything a UI needs to replay it.

Same loop as experiments.run_condition, but instead of only aggregate metrics
it records a per-step trace (observation, decision probabilities, outcome,
memory stats, active context) plus a final memory snapshot. No files written.
"""

from __future__ import annotations

import copy
import random

from .agent import Agent
from .decision import HeuristicDecisionModel, JevDecisionModel
from .env import AssociationEnvironment
from .experiments import PHASES
from .llm import RizzoFlowBackend
from .memory.event_log import EventLog
from .memory.sqlite_store import SqliteStore
from .metrics import Metrics

DEFAULT_FLAGS = {
    "use_working_memory": True,
    "use_long_term": True,
    "use_plasticity": True,
    "use_consolidation": True,
    "use_replay": True,
}


def build_decision_model(backend: str, config: dict, seed: int):
    if backend == "jev":
        return JevDecisionModel(RizzoFlowBackend(config.get("server_url")))
    return HeuristicDecisionModel(random.Random(seed))


def run_simulation(
    base_config: dict,
    seed: int = 0,
    steps: int | None = None,
    flags: dict | None = None,
    backend: str = "heuristic",
) -> dict:
    config = copy.deepcopy(base_config)
    config["seed"] = seed
    config["backend"] = backend
    config["flags"] = dict(DEFAULT_FLAGS if flags is None else flags)
    if steps is not None:
        config["steps"] = steps

    store = SqliteStore(":memory:")
    log = EventLog()
    model = build_decision_model(backend, config, seed)
    agent = Agent(config, model, store, log)
    env = AssociationEnvironment(config, random.Random(seed))

    metrics = Metrics()
    trace: list[dict] = []
    oks: list[bool] = []
    for step in range(config.get("steps", 400)):
        result = agent.run_step(env)
        stats = agent.memory_stats()
        metrics.record(result, stats["logical_memory_size"], stats["L2_ltm_size"])
        metrics.context_sizes.append(agent.context_manager.last_context_chars)
        oks.append(result["ok"])

        decision = result["decision"]
        trace.append(
            {
                "step": step,
                "text": result["observation_text"],
                "cue": env._last_cue,
                "action": decision.action,
                "probabilities": decision.probabilities,
                "confidence": decision.confidence,
                "reward": result["reward"],
                "ok": result["ok"],
                "prediction_error": result["prediction_error"],
                "surprise": result["surprise"],
                "retrieved": result["retrieved"],
                "retrieved_ids": result["retrieved_ids"],
                "context": result["context"],
                "memory": stats,
            }
        )

    summary = metrics.summary()
    summary["condition"] = "run"
    summary["storage_chars"] = sum(len(m.content) for m in store.all())
    summary["summaries"] = sum(1 for m in store.all() if m.kind == "summary")
    for name, (lo, hi) in PHASES.items():
        window = oks[lo:hi]
        summary[name] = sum(window) / len(window) if window else 0.0

    memories = [
        {
            "id": item.id,
            "content": item.content,
            "importance": round(item.importance, 4),
            "salience": round(item.salience, 4),
            "access_count": item.access_count,
            "kind": item.kind,
            "timestamp": item.timestamp,
        }
        for item in store.all()
    ]

    return {
        "backend": backend,
        "flags": config["flags"],
        "seed": seed,
        "steps": config.get("steps", 400),
        "summary": summary,
        "trace": trace,
        "memories": memories,
    }


def flag_profiles() -> dict[str, dict]:
    """Named flag presets exposed to the UI."""
    return {
        "full_memory": dict(DEFAULT_FLAGS),
        "working_memory_only": {
            "use_working_memory": True,
            "use_long_term": False,
            "use_plasticity": False,
            "use_consolidation": False,
            "use_replay": False,
        },
        "no_memory": {
            "use_working_memory": False,
            "use_long_term": False,
            "use_plasticity": False,
            "use_consolidation": False,
            "use_replay": False,
        },
    }


__all__ = ["DEFAULT_FLAGS", "build_decision_model", "flag_profiles", "run_simulation"]
