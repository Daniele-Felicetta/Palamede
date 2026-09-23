"""Run the 5-condition comparison and save results (create-only).

Usage:
    python scripts/run_experiments.py [--config config.toml] [--seeds 0 1 2]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_agent.config import load_config
from jev_agent.experiments import format_report, run_all


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=None, help="path to config.toml")
    parser.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    parser.add_argument("--steps", type=int, default=None)
    parser.add_argument(
        "--output",
        default=None,
        help="output JSON path; results are never overwritten (create-only)",
    )
    args = parser.parse_args()

    config = load_config(args.config)
    if args.steps is not None:
        config["steps"] = args.steps

    results = run_all(config, seeds=args.seeds)
    print(format_report(results))

    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "config": {k: v for k, v in config.items() if k != "flags"},
            "seeds": args.seeds,
            "results": results,
        }
        with path.open("x", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        print(f"\nwritten: {path} (create-only)")


if __name__ == "__main__":
    main()
