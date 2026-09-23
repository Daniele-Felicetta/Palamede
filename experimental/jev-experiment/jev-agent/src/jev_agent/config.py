"""Configuration loader: config.toml with defaults."""

from __future__ import annotations

import tomllib
from pathlib import Path

_DEFAULTS: dict = {
    "seed": 0,
    "backend": "heuristic",
    "server_url": "http://127.0.0.1:8017",
    "steps": 400,
    "max_reward": 5.0,
    "flags": {
        "use_working_memory": True,
        "use_long_term": True,
        "use_plasticity": True,
        "use_consolidation": True,
        "use_replay": True,
    },
    "memory": {
        "working_capacity": 8,
        "ttl_seconds": 120.0,
        "decay": 0.995,
        "forget_threshold": 0.05,
        "ltm_decay_interval": 10,
        "consolidation_interval": 50,
        "consolidation_min_group": 3,
        "consolidation_threshold": 0.90,
        "replay_interval": 100,
        "replay_size": 10,
    },
    "retrieval": {
        "k": 5,
        "w_semantic": 0.45,
        "w_recency": 0.15,
        "w_importance": 0.20,
        "w_salience": 0.10,
        "w_frequency": 0.05,
        "w_context": 0.05,
        "recency_tau": 60.0,
    },
    "plasticity": {
        "learning_rate": 0.10,
        "temporal_tau": 30.0,
        "importance_cap": 2.0,
        "salience_cap": 1.0,
    },
    "context": {"max_memories": 6, "max_chars": 4000},
    "state": {"latent_momentum": 0.9},
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | Path | None = None) -> dict:
    if path is None:
        return _deep_merge(_DEFAULTS, {})
    data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    return _deep_merge(_DEFAULTS, data)
