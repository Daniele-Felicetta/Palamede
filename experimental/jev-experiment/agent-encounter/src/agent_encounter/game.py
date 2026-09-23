"""Game logic: encounters, dialogue rounds, and the actions that change the world.

The two backends are injected, so the whole flow is testable with fakes and no
model: decisions answer "should I talk / how do they feel / what do I do", and
the dialogue backend produces the agent's spoken lines.
"""

from __future__ import annotations

from . import prompts, world
from .decisions import LocalDecisions
from .dialogs import LocalDialogs
from .state import Session


class Game:
    def __init__(self, decisions, dialogues, fallback_decisions=None, fallback_dialogues=None):
        self.session = Session()
        self.decisions = decisions
        self.dialogues = dialogues
        self.fallback_decisions = fallback_decisions or LocalDecisions()
        self.fallback_dialogues = fallback_dialogues or LocalDialogs()
        self.mode = "rizzo"
        self.last_error: str | None = None

    # -- helpers --------------------------------------------------------
    def _decide(self, method: str, *args):
        try:
            decision = getattr(self.decisions, method)(*args)
            self.mode = "rizzo" if decision.source == "rizzo" else "local"
            return decision
        except Exception as exc:  # noqa: BLE001 - degrade instead of crashing the game
            self.last_error = str(exc)
            self.mode = "local"
            return getattr(self.fallback_decisions, method)(*args)

    def _talk(self, npc: dict, player_line: str) -> str:
        try:
            line = self.dialogues.reply(npc, self.session, player_line)
            return line
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            self.mode = "local"
            return self.fallback_dialogues.reply(npc, self.session, player_line)

    @staticmethod
    def _npc_public(npc: dict, session) -> dict:
        state = session.npc(npc["id"])
        return {
            "id": npc["id"],
            "name": npc["name"],
            "role": npc["role"],
            "color": npc["color"],
            "x": npc["pos"][0],
            "y": npc["pos"][1],
            "sprite": npc.get("sprite", 0),
            "tint": npc.get("tint"),
            "traits": npc["traits"],
            "knows_secret": npc["knows_secret"],
            "relationship": round(state.relationship, 2),
            "talks": state.talks,
            "last_summary": state.last_summary,
        }

    def snapshot(self) -> dict:
        session = self.session
        return {
            "map": {
                "w": world.MAP_W,
                "h": world.MAP_H,
                "tile": world.TILE,
                "ground": world.ground_indices(),
                "objects": world.object_indices(),
                "palette": world.PALETTE,
                "tiles": {k: list(v) for k, v in world.TILES.items()},
                "sheets": world.SHEETS,
            },
            "player": session.player.to_dict(),
            "npcs": [self._npc_public(npc, session) for npc in world.NPC_DEFS],
            "cache": {
                "x": world.CACHE_POS[0],
                "y": world.CACHE_POS[1],
                "revealed": session.cache_revealed,
                "taken": session.cache_taken,
            },
            "items": world.ITEMS,
            "log": session.log[-12:],
            "mode": self.mode,
        }

    # -- movement -------------------------------------------------------
    def move(self, dx: int, dy: int) -> dict:
        session = self.session
        nx, ny = session.player.x + dx, session.player.y + dy
        moved = False
        free = world.is_walkable(nx, ny, session.cache_revealed)
        free = free and all(npc["pos"] != (nx, ny) for npc in world.NPC_DEFS)
        if free:
            session.player.x, session.player.y = nx, ny
            session.steps += 1
            moved = True
        reward = self._collect_cache()
        return {
            "moved": moved,
            "player": session.player.to_dict(),
            "cache": {
                "revealed": session.cache_revealed,
                "taken": session.cache_taken,
            },
            "reward": reward,
        }

    def _collect_cache(self) -> dict | None:
        session = self.session
        player = session.player
        if (
            session.cache_revealed
            and not session.cache_taken
            and (player.x, player.y) == world.CACHE_POS
        ):
            session.cache_taken = True
            player.gold += 15
            session.note("Hai trovato la cassa nascosta: +15 monete.")
            return {"gold": 15, "text": "Cassa trovata! +15 monete d'oro."}
        return None

    def adjacent_npc(self) -> dict | None:
        session = self.session
        for npc in world.NPC_DEFS:
            x, y = npc["pos"]
            if abs(x - session.player.x) + abs(y - session.player.y) == 1:
                return npc
        return None

    # -- encounter ------------------------------------------------------
    def encounter(self, npc_id: str) -> dict:
        npc = world.npc_by_id(npc_id)
        if npc is None:
            raise KeyError(f"Unknown agent: {npc_id}")
        decision = self._decide("engage", npc, self.session)
        return {
            "npc": self._npc_public(npc, self.session),
            "decision": decision.to_dict(),
            "mode": self.mode,
        }

    def decline(self, npc_id: str) -> dict:
        npc = world.npc_by_id(npc_id)
        if npc is None:
            raise KeyError(f"Unknown agent: {npc_id}")
        state = self.session.npc(npc_id)
        state.relationship -= 0.15
        state.relationship = max(-3.0, state.relationship)
        self.session.note(f"Hai ignorato {npc['name']}.")
        return {"npc": self._npc_public(npc, self.session), "mode": self.mode}

    def talk(self, npc_id: str, player_line: str = "") -> dict:
        npc = world.npc_by_id(npc_id)
        if npc is None:
            raise KeyError(f"Unknown agent: {npc_id}")
        state = self.session.npc(npc_id)
        if state.talks == 0:
            state.talks = 1
            self.session.note(f"Hai parlato con {npc['name']}.")

        line = self._talk(npc, player_line)
        state.remember("user", prompts.dialog_user_prompt(npc, self.session, player_line))
        state.remember("assistant", line)

        attitude = self._decide("attitude", npc, self.session, player_line, line)
        score = attitude.value if isinstance(attitude.value, (int, float)) else 2.0
        state.add_relationship((score - 2.0) * 0.35)
        return {
            "line": line,
            "attitude": attitude.to_dict(),
            "npc": self._npc_public(npc, self.session),
            "player": self.session.player.to_dict(),
            "mode": self.mode,
        }

    def actions(self, npc_id: str) -> dict:
        npc = world.npc_by_id(npc_id)
        if npc is None:
            raise KeyError(f"Unknown agent: {npc_id}")
        decision = self._decide("action", npc, self.session)
        available = prompts.available_actions(npc, self.session)
        return {
            "npc": self._npc_public(npc, self.session),
            "decision": decision.to_dict(),
            "available": available,
            "mode": self.mode,
        }

    def resolve(self, npc_id: str, action_id: str) -> dict:
        npc = world.npc_by_id(npc_id)
        if npc is None:
            raise KeyError(f"Unknown agent: {npc_id}")
        if action_id not in prompts.available_actions(npc, self.session):
            raise ValueError(f"Action not available here: {action_id}")
        narrative = self._apply(npc, action_id)
        state = self.session.npc(npc_id)
        state.last_summary = f"{world.ACTIONS[action_id]['label']}; rapporto {state.relationship:+.1f}"
        self.session.note(f"{npc['name']}: {narrative}")
        return {
            "action": action_id,
            "narrative": narrative,
            "npc": self._npc_public(npc, self.session),
            "player": self.session.player.to_dict(),
            "cache": {"revealed": self.session.cache_revealed, "taken": self.session.cache_taken},
            "mode": self.mode,
        }

    def _apply(self, npc: dict, action_id: str) -> str:
        session = self.session
        player = session.player
        state = session.npc(npc["id"])
        if action_id == "give_potion":
            player.items["pozione"] -= 1
            state.add_relationship(1.0)
            return f"{npc['name']} accetta la pozione e ti ringrazia con un cenno."
        if action_id == "trade":
            player.items["gemma"] -= 1
            paid = 8 + int(npc["traits"]["greed"] * 6)
            player.gold += paid
            state.add_relationship(0.5)
            return f"Scambio fatto: {npc['name']} ti paga {paid} monete d'oro."
        if action_id == "ask_rumor":
            session.cache_revealed = True
            state.add_relationship(0.5)
            return f"{npc['name']} ti indica un punto nascosto tra l'erba."
        if action_id == "challenge":
            won = state.relationship < 0 or player.hp >= 4
            player.hp = max(1, player.hp - 1)
            state.add_relationship(-1.5)
            if won:
                player.gold += 6
                return f"Hai vinto il duello con {npc['name']}: +6 monete, ma sei ferito."
            return f"{npc['name']} ti mette in fuga. Perdi un punto salute."
        return f"Saluti {npc['name']} e torni sul sentiero."

    def reset(self) -> dict:
        self.session.reset()
        self.mode = "rizzo"
        self.last_error = None
        return self.snapshot()
