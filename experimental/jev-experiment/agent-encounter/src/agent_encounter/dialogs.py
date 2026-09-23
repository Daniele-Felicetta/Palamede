"""The dialogue layer: vanilla Spark generation (real text, token by token)."""

from __future__ import annotations

import random

from . import prompts

MAX_TOKENS = 72
TEMPERATURE = 0.8
TOP_K = 40


class SparkDialogs:
    def __init__(self, hub) -> None:
        self.hub = hub
        self.rng = random.Random(7)

    def reply(self, npc: dict, session, player_line: str) -> str:
        messages = prompts.dialog_messages(npc, session, player_line)
        seed = self.rng.randrange(1, 1_000_000)
        text = self.hub.generate(
            messages, max_tokens=MAX_TOKENS, temperature=TEMPERATURE, top_k=TOP_K, seed=seed
        )
        if not text:
            text = LocalDialogs().reply(npc, session, player_line)
        return text


_COLD = {
    "mercante": "Se non hai monete da spendere, non ho tempo da perdere.",
    "contadino": "Stavo giusto tornando dai campi… c'è qualcosa che non va?",
    "eremita": "Poche parole sono già troppe. Dimmi cosa cerchi, o vattene.",
    "guardiana": "Fermati dove sei. Che vuoi da me, straniero?",
    "viandante": "Il mantello mi copre il volto, non i pensieri. Parla.",
}
_WARM = {
    "mercante": "Per te un prezzo onesto, come sempre. Cosa ti serve?",
    "contadino": "Ehilà! Siediti un momento, che ti racconto dei campi.",
    "eremita": "Vedo che insisti con rispetto. Ti ascolto, questa volta.",
    "guardiana": "Sei tornato. Bene: forse posso fidarmi un poco.",
    "viandante": "Ci conosciamo ormai. C'è una cosa che dovresti sapere.",
}


class LocalDialogs:
    """Offline fallback: one canned line, warmer with a better relationship."""

    def reply(self, npc: dict, session, player_line: str) -> str:
        table = _WARM if session.npc(npc["id"]).relationship > 0.5 else _COLD
        return table.get(npc["role"], f"{npc['name']} ti guarda in silenzio.")
