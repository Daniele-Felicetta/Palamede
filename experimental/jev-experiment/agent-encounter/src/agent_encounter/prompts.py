"""Pure builders for the two backends: typed questions for rizzo-flow, chat
messages for vanilla Spark. No I/O here, so the shapes are unit-testable.
"""

from __future__ import annotations

from . import world

LOCATION = "radura al crepuscolo, tra il sentiero e lo stagno"

ATTITUDE_LEVELS = [
    "Ostile: ti guarda con disprezzo e vorrebbe che te ne andassi.",
    "Diffidente: resta sulla difensiva e non si fida di te.",
    "Neutrale: ti ascolta senza particolare interesse.",
    "Amichevole: ti tratta con una certa cordialità.",
    "Entusiasta: è felice di parlare con te e ti considererebbe un alleato.",
]


def relationship_label(rel: float) -> str:
    if rel <= -2:
        return "ostile"
    if rel < -0.5:
        return "diffidente"
    if rel <= 0.5:
        return "neutrale"
    if rel <= 2:
        return "amichevole"
    return "affezionato"


def trait_summary(traits: dict) -> str:
    words = []
    words.append("cordiale" if traits["friendly"] >= 0.7 else "chiuso" if traits["friendly"] <= 0.3 else "equilibrato")
    if traits["patience"] <= 0.3:
        words.append("impaziente")
    if traits["greed"] >= 0.7:
        words.append("avido")
    return ", ".join(words)


def _player_block(session) -> dict:
    player = session.player
    items = {name: count for name, count in player.items.items() if count > 0}
    return {
        "salute": f"{player.hp}/{player.max_hp}",
        "oro": player.gold,
        "oggetti": items,
    }


def _agent_block(npc: dict, session) -> dict:
    npc_state = session.npc(npc["id"])
    block = {
        "nome": npc["name"],
        "ruolo": npc["role"],
        "carattere": trait_summary(npc["traits"]),
        "rapporto": relationship_label(npc_state.relationship),
        "incontri": npc_state.talks,
    }
    if npc_state.last_summary:
        block["ultimo_incontro"] = npc_state.last_summary
    return block


def engagement_request(npc: dict, session) -> tuple[dict, dict]:
    """Should the player talk to this agent? A single typed boolean."""
    state = {
        "luogo": LOCATION,
        "giocatore": _player_block(session),
        "agente": _agent_block(npc, session),
    }
    questions = {
        "engage": {
            "type": "boolean",
            "instructions": (
                f"Vale la pena avvicinarsi e parlare con {npc['name']}? "
                "Giudica in base al carattere dell'agente, al rapporto attuale e "
                "alle condizioni del giocatore."
            ),
            "true_description": "Sì: conviene rivolgergli la parola adesso.",
            "false_description": "No: meglio non parlargli e proseguire.",
            "policy": {"allow_abstain": False},
        }
    }
    return state, questions


def attitude_request(npc: dict, session, player_line: str, npc_line: str) -> tuple[dict, dict]:
    """After one exchange, how does the agent feel about the player now?"""
    state = {
        "luogo": LOCATION,
        "agente": _agent_block(npc, session),
        "scambio": {
            "giocatore_ha_detto": player_line or "(si è solo avvicinato in silenzio)",
            "agente_ha_risposto": npc_line,
        },
    }
    questions = {
        "attitude": {
            "type": "score",
            "instructions": (
                f"Dopo questo scambio, come si sente {npc['name']} verso il giocatore?"
            ),
            "levels": ATTITUDE_LEVELS,
            "policy": {"allow_abstain": False},
        }
    }
    return state, questions


def available_actions(npc: dict, session) -> list[str]:
    actions = ["give_potion"]
    if session.player.items.get("gemma", 0) > 0:
        actions.append("trade")
    if npc.get("knows_secret") and not session.cache_revealed:
        actions.append("ask_rumor")
    if npc["traits"]["patience"] <= 0.5 or session.npc(npc["id"]).relationship < 0:
        actions.append("challenge")
    actions.append("leave")
    return actions


def action_request(npc: dict, session) -> tuple[dict, dict]:
    """What should the player actually do with this agent?"""
    action_ids = available_actions(npc, session)
    state = {
        "luogo": LOCATION,
        "giocatore": _player_block(session),
        "agente": _agent_block(npc, session),
    }
    options = [
        {"id": action_id, "description": world.ACTIONS[action_id]["description"]}
        for action_id in action_ids
    ]
    questions = {
        "action": {
            "type": "choice",
            "instructions": (
                f"Cosa conviene fare ora con {npc['name']}? Scegli l'azione più utile "
                "per il giocatore date le circostanze."
            ),
            "options": options,
            "policy": {"allow_abstain": False},
        }
    }
    return state, questions


def dialog_system_prompt(npc: dict, session) -> str:
    npc_state = session.npc(npc["id"])
    return (
        f"Sei {npc['name']}, {npc['role']} di un piccolo villaggio. {npc['persona']} "
        f"Il tuo rapporto con il giocatore è {relationship_label(npc_state.relationship)} "
        f"(incontri precedenti: {npc_state.talks}). "
        f"Rispondi SEMPRE in italiano, in character, in una sola frase breve e concreta. "
        "Non descrivere pensieri, non usare elenchi, non firmarti con il tuo nome."
    )


def dialog_user_prompt(npc: dict, session, player_line: str) -> str:
    player = session.player
    items = ", ".join(f"{n} x{c}" for n, c in player.items.items() if c > 0) or "niente"
    context = (
        f"[scena] {LOCATION}. Il giocatore ha {player.hp}/{player.max_hp} di salute, "
        f"{player.gold} monete d'oro e con sé: {items}."
    )
    if session.npc(npc["id"]).last_summary:
        context += f" [ultimo incontro] {session.npc(npc['id']).last_summary}"
    line = player_line.strip() or "Il giocatore ti si avvicina e ti saluta con un cenno."
    return f"{context}\n[giocatore] {line}"


def dialog_messages(npc: dict, session, player_line: str) -> list[dict]:
    """Full chat for vanilla Spark: one system message, then the recent history."""
    npc_state = session.npc(npc["id"])
    messages = [{"role": "system", "content": dialog_system_prompt(npc, session)}]
    messages.extend(npc_state.history[-6:])
    messages.append({"role": "user", "content": dialog_user_prompt(npc, session, player_line)})
    return messages
