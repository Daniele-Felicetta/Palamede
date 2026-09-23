"""The Agent: the full perception-decision-memory loop.

OBSERVATION -> PERCEPTION/ENCODING -> CURRENT STATE -> MEMORY RETRIEVAL ->
DECISION MODEL -> ACTION -> OUTCOME -> MEMORY UPDATE -> STATE UPDATE.
"""

from __future__ import annotations

import random

from . import clock
from .clock import now
from .consolidation import Consolidator
from .context import ContextManager
from .decision import Decision, DecisionModel
from .forgetting import Forgetting
from .memory.event_log import EventLog
from .memory.items import Experience, MemoryItem
from .memory.store import MemoryStore
from .memory.working import WorkingMemory
from .perception import Action, Environment, Observation
from .plasticity import Plasticity
from .prediction import PredictionError
from .retrieval import Retrieval, embed
from .state import AgentState


class AgentFlags:
    def __init__(self, config: dict):
        f = config.get("flags", {})
        self.use_working_memory = f.get("use_working_memory", True)
        self.use_long_term = f.get("use_long_term", True)
        self.use_plasticity = f.get("use_plasticity", True)
        self.use_consolidation = f.get("use_consolidation", True)
        self.use_replay = f.get("use_replay", True)


class Agent:
    def __init__(
        self,
        config: dict,
        decision_model: DecisionModel,
        ltm_store: MemoryStore | None = None,
        event_log: EventLog | None = None,
        rng: random.Random | None = None,
    ):
        self.config = config
        self.flags = AgentFlags(config)
        self.rng = rng or random.Random(config.get("seed", 0))

        memory_cfg = config.get("memory", {})
        self.working = WorkingMemory(
            capacity=memory_cfg.get("working_capacity", 8),
            ttl=memory_cfg.get("ttl_seconds", 120.0),
            decay=memory_cfg.get("decay", 0.995),
        )
        self.ltm = ltm_store
        self.log = event_log
        self.retrieval = Retrieval(config.get("retrieval", {}))
        self.plasticity = Plasticity(**{k: v for k, v in config.get("plasticity", {}).items()})
        self.forgetting = Forgetting(threshold=memory_cfg.get("forget_threshold", 0.05))
        self.consolidator = Consolidator(
            threshold=memory_cfg.get("consolidation_threshold", 0.72),
            min_group=memory_cfg.get("consolidation_min_group", 3),
        )
        self.context_manager = ContextManager(**config.get("context", {}))
        self.decision_model = decision_model

        self.state = AgentState(goals=["maximize reward"])
        self.steps = 0
        self._recent_outcomes: list[dict] = []
        # Bind the logical clock to the step counter: one step = one logical
        # second, so TTL/recency/decay/plasticity are meaningful in simulation.
        clock.set_clock(lambda: float(self.steps))
        self._replay = None
        if self.flags.use_replay:
            from .replay import Replay

            self._replay = Replay(self.rng)

    # -- cycle -----------------------------------------------------------

    def run_step(self, env: Environment) -> dict:
        observation = env.observe()
        query = self._query_from(observation)

        retrieved: list[MemoryItem] = []
        if self.flags.use_long_term and self.ltm is not None:
            retrieved = self.retrieval.retrieve(
                self.ltm, query, self.state, k=self.config.get("retrieval", {}).get("k", 5)
            )
        if self.flags.use_working_memory:
            # Working memory is a *subset* of LTM when both are on: merge by id
            # so the same experience is never handed to the model twice.
            seen = {m.id for m in retrieved}
            retrieved = retrieved + [m for m in self.working.items() if m.id not in seen]

        # Active context: only a small retrieved slice ever reaches the model,
        # no matter how much the logical memory grows.
        context = self.context_manager.build(retrieved, query, self._recent_outcomes)
        decision = self.decision_model.decide(
            self.state, observation, retrieved, env.actions(), context
        )
        result = env.act(Action(decision.action))
        self._recent_outcomes.append(
            {"action": decision.action, "reward": round(result.reward, 2)}
        )
        self._recent_outcomes = self._recent_outcomes[-5:]

        expected = self._expected_outcome(decision)
        actual = self._actual_outcome(result, decision)
        pe = PredictionError.compute(expected, actual)
        surprise = 1.0 - decision.confidence

        experience = Experience(
            observation={
                "text": observation.text,
                "structured": observation.structured,
                "metadata": observation.metadata,
            },
            state_before={"context": dict(self.state.current_context), "confidence": self.state.confidence},
            retrieved_memories=[m.id for m in retrieved],
            decision=decision.to_dict(),
            action=decision.action,
            expected_outcome=expected,
            actual_outcome=actual,
            reward=result.reward,
            prediction_error=pe.error,
        )
        if self.log is not None:
            self.log.append(experience)

        # New experiences start from the outcome: successful actions are born
        # more important than failures, plasticity then adjusts from there.
        base_importance = 0.5 + 0.1 * (1.0 if result.ok else 0.0) + 0.2 * pe.error
        memory_item = MemoryItem(
            id=f"mem-{self.steps}-{experience.id[:8]}",
            content=(
                f"{query} -> action {decision.action} "
                f"({'reward' if result.ok else 'no reward'}={result.reward:.2f})"
            ),
            timestamp=now(),
            importance=base_importance,
            salience=0.5,
            embedding=embed(query + " " + decision.action),
        )
        if self.flags.use_plasticity:
            self.plasticity.update(
                memory_item,
                reward=result.reward,
                surprise=surprise,
                prediction_error=pe.error,
            )
        self.working.add(memory_item)
        if self.flags.use_long_term and self.ltm is not None:
            self.ltm.add(memory_item)

        self._maintenance()
        self.state = self.state.update(
            observation, retrieved, decision.action, result,
            momentum=self.config.get("state", {}).get("latent_momentum", 0.9),
        )
        self.steps += 1

        return {
            "decision": decision,
            "reward": result.reward,
            "ok": result.ok,
            "prediction_error": pe.error,
            "surprise": surprise,
            "retrieved": len(retrieved),
            "observation_text": observation.text,
            "context": context,
            "retrieved_ids": [m.id for m in retrieved],
        }

    def _maintenance(self) -> None:
        memory_cfg = self.config.get("memory", {})
        if self.steps % memory_cfg.get("ltm_decay_interval", 10) == 0 and self.ltm:
            self.forgetting.sweep(self.ltm)
        if (
            self.steps % memory_cfg.get("consolidation_interval", 50) == 0
            and self.flags.use_consolidation
            and self.ltm
        ):
            self.consolidator.consolidate(self.ltm)
        if (
            self._replay is not None
            and self.log is not None
            and self.steps % memory_cfg.get("replay_interval", 100) == 0
            and self.steps > 0
        ):
            self._replay.replay(
                self.log,
                self.plasticity,
                self.ltm,
                size=memory_cfg.get("replay_size", 10),
            )

    # -- helpers ----------------------------------------------------------

    @staticmethod
    def _query_from(observation: Observation) -> str:
        return observation.text or str(observation.structured)

    @staticmethod
    def _expected_outcome(decision: Decision) -> float:
        return decision.probabilities.get(decision.action, 0.5)

    @staticmethod
    def _actual_outcome(result, decision: Decision) -> float:
        return 1.0 if result.ok else 0.0

    # -- introspection -----------------------------------------------------

    def memory_stats(self) -> dict:
        """Memory hierarchy: L0 active context, L1 working, L2 LTM, L3 summaries.

        The counts make the central property measurable: logical capacity grows
        with experience while L0 stays bounded (the context handed to the model
        is built by ContextManager, never the whole store).
        """
        items = self.ltm.all() if self.ltm else []
        summaries = sum(1 for m in items if m.kind == "summary")
        episodes = sum(1 for m in items if m.kind == "episodic")
        working_items = self.working.items()
        # Working memory items also live in LTM: logical size is the union of
        # ids, not L2 + L1 (which would count the same experience twice).
        distinct_ids = {m.id for m in items} | {m.id for m in working_items}
        return {
            "L0_active_context_chars": self.context_manager.last_context_chars,
            "L1_working_memory_size": len(working_items),
            "L2_ltm_size": len(items),
            "L3_summary_count": summaries,
            "logical_memory_size": len(distinct_ids),
            "episodes": episodes,
            "steps": self.steps,
        }
