"""Debug: raw Jev answer for cue A vs cue B, from an untrained agent state."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import httpx

hypo = {
    "state": (
        "Observation:\nsignal B rock\n"
        "Recent outcomes (oldest first): X->0.0, X->0.0\n"
        "Relevant past experiences:\n"
        "- signal B -> action X (no reward=0.00)\n"
        "- signal B -> action Y (reward=5.00)\n"
        "- signal A -> action X (reward=5.00)"
    ),
    "model": "rizzo-latest",
    "questions": {
        "pick_action": {
            "type": "choice",
            "instructions": (
                "The agent maximizes reward. Past experiences show which "
                "signals pay out after which actions. Which action should "
                "the agent take now?"
            ),
            "criteria": {"act_0": "Take action X", "act_1": "Take action Y", "act_2": "Take action Z"},
        }
    },
}

for label, cue in [("cue B (Y correct)", "signal B rock"), ("cue A (X correct)", "signal A fog")]:
    body = dict(hypo)
    body["state"] = hypo["state"].replace("signal B rock", cue if cue in hypo["state"] else "").replace(
        "Observation:\nsignal B rock", f"Observation:\n{cue}"
    )
    r = httpx.post("http://127.0.0.1:8017/v1/systemone", json=body, timeout=120)
    a = r.json()["answers"]["pick_action"]
    print(cue, "->", a["choice"], {k: round(v, 3) for k, v in a["probabilities"].items()})
