"""Simulated test environment.

The agent must learn associations  A -> action X -> reward,  B -> action Y ->
reward, and later recognize the relations after many other experiences.

Injected challenges, on a 400-step schedule:
  steps 0-199   basic associations (A->X, B->Y), 1 distractor token
  step 200      context drift: A->X is remapped to A->Y
  steps 260-289 conflicting memories: B->X briefly pays a smaller reward
  steps 300+    decay pressure: 4 distractor tokens dilute retrieval
  from step 50  rare high-value events: "signal R" -> action Z, reward = max
"""

from __future__ import annotations

import random

from .perception import Action, ActionResult, Observation

NOISE_CUES = ["C", "D", "E", "F", "G"]
DISTRACTORS = ["fog", "rock", "moss", "dust", "wind", "sand", "rain", "ash"]


class AssociationEnvironment:
    """Discrete cue -> correct action environment with a reward schedule."""

    def __init__(self, config: dict, rng: random.Random | None = None):
        self.rng = rng or random.Random(config.get("seed", 0))
        self.max_reward = config.get("max_reward", 5.0)
        self.associations: dict[str, str] = {"A": "X", "B": "Y", "R": "Z"}
        self.all_actions = ["X", "Y", "Z"]
        self.step_count = 0
        self._last_cue = "noise"
        self.drift_at = 200
        self.conflict_from = 260
        self.conflict_until = 289
        self.decay_from = 300
        self.rare_from = 50

    def actions(self) -> list[str]:
        return list(self.all_actions)

    def _distractors(self, n: int) -> str:
        return " ".join(self.rng.choice(DISTRACTORS) for _ in range(n))

    def observe(self) -> Observation:
        roll = self.rng.random()
        if roll < 0.40:
            cue = "A"
        elif roll < 0.80:
            cue = "B"
        elif self.step_count >= self.rare_from and roll < 0.86:
            cue = "R"  # rare high-value event
        else:
            cue = self.rng.choice(NOISE_CUES)

        self._last_cue = cue
        if self.step_count >= self.decay_from:
            n_extra = 4  # decay pressure: dilute the cue among distractors
        else:
            n_extra = 1
        text = f"signal {cue} {self._distractors(n_extra)}"
        return Observation.now(text=text, structured={"cue": cue, "step": self.step_count})

    def act(self, action: Action) -> ActionResult:
        cue = self._last_cue
        expected = self.associations.get(cue)
        self.step_count += 1

        if self.step_count == self.drift_at + 1:
            # context drift: A->X becomes A->Y
            self.associations["A"] = "Y"
        if self.conflict_from <= self.step_count <= self.conflict_until:
            # conflicting memories: B->X suddenly pays (a smaller reward)
            self.associations["B"] = "X"
        elif self.step_count > self.conflict_until:
            self.associations["B"] = "Y"

        if expected is None:
            return ActionResult(ok=False, reward=0.0, detail="noise cue")
        if action.name == expected:
            return ActionResult(ok=True, reward=self.max_reward, detail="correct")
        return ActionResult(ok=False, reward=0.0, detail="wrong action")
