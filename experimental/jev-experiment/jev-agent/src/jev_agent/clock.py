"""Logical clock for simulations.

All memory lifetimes (TTL, recency, decay, plasticity temporal factors) are
computed in logical seconds. The agent binds the clock to its step counter, so
one simulation step equals one second of logical time. Real deployments simply
leave the default wall clock in place.
"""

from __future__ import annotations

import time
from collections.abc import Callable

_source: Callable[[], float] = time.monotonic


def now() -> float:
    return _source()


def set_clock(source: Callable[[], float] | None) -> None:
    """Override the time source. Pass None to restore the wall clock."""
    global _source
    _source = source if source is not None else time.monotonic
