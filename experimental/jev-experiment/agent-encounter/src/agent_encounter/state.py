"""Mutable game state: the player, what each agent remembers, and the world flags."""

from __future__ import annotations

from dataclasses import dataclass, field

from . import world

REL_MIN, REL_MAX = -3.0, 3.0


@dataclass
class Player:
    x: int = world.PLAYER_SPAWN[0]
    y: int = world.PLAYER_SPAWN[1]
    hp: int = 6
    max_hp: int = 6
    gold: int = 4
    items: dict[str, int] = field(default_factory=lambda: {"pozione": 2, "gemma": 1})

    def to_dict(self) -> dict:
        return {
            "x": self.x,
            "y": self.y,
            "hp": self.hp,
            "max_hp": self.max_hp,
            "gold": self.gold,
            "items": dict(self.items),
        }


@dataclass
class NPCState:
    npc_id: str
    relationship: float = 0.0
    talks: int = 0
    last_summary: str = ""
    history: list[dict] = field(default_factory=list)

    def add_relationship(self, delta: float) -> None:
        self.relationship = max(REL_MIN, min(REL_MAX, self.relationship + delta))

    def remember(self, role: str, content: str) -> None:
        self.history.append({"role": role, "content": content})
        self.history = self.history[-8:]

    def to_dict(self) -> dict:
        return {
            "npc_id": self.npc_id,
            "relationship": round(self.relationship, 2),
            "talks": self.talks,
            "last_summary": self.last_summary,
        }


class Session:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.player = Player()
        self.npcs: dict[str, NPCState] = {
            npc["id"]: NPCState(npc["id"]) for npc in world.NPC_DEFS
        }
        self.cache_revealed = False
        self.cache_taken = False
        self.steps = 0
        self.log: list[str] = []

    def npc(self, npc_id: str) -> NPCState:
        return self.npcs[npc_id]

    def note(self, text: str) -> None:
        self.log.append(text)
        self.log = self.log[-40:]

    def to_dict(self) -> dict:
        return {
            "player": self.player.to_dict(),
            "npcs": {npc_id: state.to_dict() for npc_id, state in self.npcs.items()},
            "cache_revealed": self.cache_revealed,
            "cache_taken": self.cache_taken,
            "steps": self.steps,
            "log": self.log[-12:],
        }
