"""Experiment runner: compares memory configurations quantitatively.

Conditions:
  1. no memory           (no WM, no LTM)
  2. working memory only
  3. long-term retrieval (WM + LTM)
  4. + plasticity
  5. + consolidation

Reports overall and per-phase accuracy. Phases match the environment schedule
(learning, post-drift adaptation, conflicting memories, decay pressure).
"""

from __future__ import annotations

import copy
import random

from .agent import Agent
from .decision import HeuristicDecisionModel
from .env import AssociationEnvironment
from .memory.event_log import EventLog
from .memory.sqlite_store import SqliteStore
from .metrics import Metrics

FLAG_PROFILES = {
    "no_memory": {
        "use_working_memory": False,
        "use_long_term": False,
        "use_plasticity": False,
        "use_consolidation": False,
        "use_replay": False,
    },
    "working_memory_only": {
        "use_working_memory": True,
        "use_long_term": False,
        "use_plasticity": False,
        "use_consolidation": False,
        "use_replay": False,
    },
    "long_term": {
        "use_working_memory": True,
        "use_long_term": True,
        "use_plasticity": False,
        "use_consolidation": False,
        "use_replay": False,
    },
    "plasticity": {
        "use_working_memory": True,
        "use_long_term": True,
        "use_plasticity": True,
        "use_consolidation": False,
        "use_replay": False,
    },
    "consolidation": {
        "use_working_memory": True,
        "use_long_term": True,
        "use_plasticity": True,
        "use_consolidation": True,
        "use_replay": True,
    },
}

PHASES = {
    "learn_100_200": (100, 200),
    "post_drift_200_260": (200, 260),
    "conflict_260_290": (260, 290),
    "decay_300_400": (300, 400),
}


def run_condition(base_config: dict, condition: str, seed: int = 0) -> dict:
    config = copy.deepcopy(base_config)
    config["flags"] = dict(FLAG_PROFILES[condition])
    config["seed"] = seed

    store = SqliteStore(":memory:")
    log = EventLog()
    agent = Agent(config, HeuristicDecisionModel(random.Random(seed)), store, log)
    env = AssociationEnvironment(config, random.Random(seed))

    metrics = Metrics()
    oks: list[bool] = []
    for _ in range(config.get("steps", 400)):
        result = agent.run_step(env)
        oks.append(result["ok"])
        stats = agent.memory_stats()
        metrics.record(result, stats["logical_memory_size"], stats["L2_ltm_size"])
        metrics.context_sizes.append(agent.context_manager.last_context_chars)

    summary = metrics.summary()
    summary["condition"] = condition
    summary["storage_chars"] = sum(len(m.content) for m in store.all())
    summary["summaries"] = sum(1 for m in store.all() if m.kind == "summary")
    for name, (lo, hi) in PHASES.items():
        window = oks[lo:hi]
        summary[name] = sum(window) / max(1, len(window)) if window else 0.0
    return summary


def run_all(base_config: dict, seeds: list[int] | None = None) -> dict[str, dict]:
    seeds = seeds or [0]
    results: dict[str, dict] = {}
    for condition in FLAG_PROFILES:
        runs = [run_condition(base_config, condition, seed) for seed in seeds]
        if len(runs) == 1:
            results[condition] = runs[0]
            continue
        averaged = {"condition": condition}
        for key in runs[0]:
            values = [r[key] for r in runs if isinstance(r[key], (int, float))]
            if len(values) == len(runs):
                averaged[key] = sum(values) / len(values)
        results[condition] = averaged
    return results


def format_report(results: dict[str, dict]) -> str:
    header = (
        f"{'condition':<22} {'accuracy':>9} {'mean_r':>7} {'mean_PE':>8} "
        f"{'logical':>8} {'ctx':>6} {'drift':>6} {'confl':>6} {'decay':>6}"
    )
    lines = [header, "-" * len(header)]
    for name, s in results.items():
        lines.append(
            f"{name:<22} {s['decision_accuracy']:>9.3f} {s['mean_reward']:>7.3f} "
            f"{s['mean_prediction_error']:>8.3f} {s['final_logical_memory_size']:>8.0f} "
            f"{s['mean_context_chars']:>6.0f} {s['post_drift_200_260']:>6.2f} "
            f"{s['conflict_260_290']:>6.2f} {s['decay_300_400']:>6.2f}"
        )
    return "\n".join(lines)
