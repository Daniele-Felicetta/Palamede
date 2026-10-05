"""Palamede — Osservatorio: configurazione dell'esperimento.

Un solo file JSON dichiara tutto cio' che l'osservatorio puo' fare: dove sta
il checkpoint, se l'addestramento e' FULL o LORA, iperparametri, precisione.
Nessun default nascosto: `Config.load()` legge, `Config.save()` scrive, e il
frontend riceve il dizionario com'era' cosi' quello che vedi e' quello che gira.

I default sono scelti per la LATENZA dell'update (un esempio -> pochi
optimizer step), non per il throughput di un training lungo.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

# Radice del repo: backend/ -> neural-observatory/ -> experimental/ -> Palamede/
ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = ROOT / "experimental" / "neural-observatory" / "configs" / "default.json"

# Checkpoint LFM2.5 230M in formato Hugging Face (bf16, 229.693.184 param).
# Non e' un GGUF: i pesi devono essere addestrabili da PyTorch. Il path e'
# relativo alla radice del repo, cosi' il config versionato gira su un'altra
# macchina senza editing.
DEFAULT_CHECKPOINT = ROOT / "models" / "lfm" / "lfm2.5-230m"
DEFAULT_CHECKPOINT_REL = "models/lfm/lfm2.5-230m"

# Precisioni accettate. "mixed" = pesi master fp32 + autocast bf16: e' il
# default perche' in bf16 puro il 25% dei tensori (tutti gli RMSNorm) riceve
# un update cosi' piccolo da arrotondare a zero, e il delta dichiarato sarebbe
# una bugia. "bf16" resta disponibile per la latenza, con l'avvertenza esplicita.
PRECISIONS = ("mixed", "bf16", "fp16", "fp32")
OPTIMIZERS = ("adamw", "adam", "sgd")
ANIMATION_MODES = ("live", "step")


@dataclass
class LoRAConfig:
    """LoRa scritto a mano (niente peft): A e B per ogni target module."""

    rank: int = 16
    alpha: float = 32.0
    dropout: float = 0.0
    # Nomi dei figli di Linear da sostituire. Solo questi esistono davvero in
    # LFM2.5: i nomi sono letti dal modulo, non dedotti da un template Llama.
    target_modules: list[str] = field(
        default_factory=lambda: ["q_proj", "k_proj", "v_proj", "out_proj", "w1", "w2", "w3"]
    )


@dataclass
class Config:
    # ── checkpoint ────────────────────────────────────────────────────
    checkpoint: str = DEFAULT_CHECKPOINT_REL

    # ── modalita' di aggiornamento ───────────────────────────────────
    mode: str = "FULL"  # "FULL" | "LORA"
    steps: int = 1  # optimizer step per esempio (1..10)
    learning_rate: float = 1e-5  # conservativo per FULL
    lora_learning_rate: float = 1e-4  # i adapter trainano piu' forte
    grad_clip: float = 1.0  # 0 = disattivato
    optimizer: str = "adamw"

    # ── forma dell'esempio ───────────────────────────────────────────
    batch_size: int = 1
    max_seq_len: int = 128  # sequenza corta: la latenza e' tutto
    add_bos: bool = True

    # ── precisione e dispositivo ─────────────────────────────────────
    precision: str = "mixed"  # vedi PRECISIONS
    device: str = "cuda"

    # ── generazione before/after ─────────────────────────────────────
    max_new_tokens: int = 24
    temperature: float = 0.0  # 0 = greedy, deterministico

    # ── cosa catturare (tutto reale, niente ricostruito) ─────────────
    collect_activations: bool = True  # norm/mean/std per layer via hook
    collect_attention: bool = True  # mappe QK reali (implica attn eager)
    collect_per_token: bool = True  # per-token: hidden norm, loss, attn

    # ── cronologia (time travel) ─────────────────────────────────────
    keep_history: int = 200  # quante voci tenere in memoria
    history_prompts: list[str] = field(default_factory=list)  # ri-eseguibili
    history_targets: list[str] = field(default_factory=list)
    # Quanti update tengono anche una copia dei pesi (bf16, CPU: ~460 MB
    # ciascuna per questo checkpoint). 0 = solo statistiche, che e' il default:
    # il confronto update A vs update B allora lavora su loss, delta per
    # layer/tensor e output, non sulla distanza vera fra i pesi. Alzalo per
    # avere la distanza parametrica esatta.
    weight_snapshot_keep: int = 0

    # ── animazione frontend ──────────────────────────────────────────
    animation_mode: str = "live"  # "live" | "step"

    # ── rete ─────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 8131

    lora: LoRAConfig = field(default_factory=LoRAConfig)

    # ── derivati ─────────────────────────────────────────────────────
    @property
    def checkpoint_path(self) -> Path:
        """Il checkpoint, come path sul filesystem.

        Un path relativo viene risolto dalla radice del repo: il file di
        configurazione e' versionato, quindi deve poter dire
        `models/lfm/lfm2.5-230m` e non un percorso assoluto di questa macchina.
        """
        p = Path(self.checkpoint)
        return p if p.is_absolute() else (ROOT / p)

    def relative_checkpoint(self) -> str:
        """Il checkpoint come path relativo alla radice, se ci sta dentro."""
        p = self.checkpoint_path
        try:
            return p.relative_to(ROOT).as_posix()
        except ValueError:
            return str(p)

    @property
    def compute_dtype(self) -> str:
        """dtype del calcolo in autocast (None se pesi nativi)."""
        return {"mixed": "bf16", "bf16": None, "fp16": "fp16", "fp32": None}[self.precision]

    @property
    def master_dtype(self) -> str:
        """dtype dei pesi memorizzati: fp32 in mixed, altrimenti la precisione."""
        return "fp32" if self.precision == "mixed" else self.precision

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Config":
        known = {f.name for f in fields(cls)}
        lora_raw = data.get("lora") or {}
        lora_known = {f.name for f in fields(LoRAConfig)}
        merged = {k: v for k, v in data.items() if k in known and k != "lora"}
        merged["lora"] = LoRAConfig(**{k: v for k, v in lora_raw.items() if k in lora_known})
        cfg = cls(**merged)
        cfg.validate()
        return cfg

    def validate(self) -> None:
        """Blocca i valori che produrrebbero un esperimento fuorviante."""
        if self.mode not in ("FULL", "LORA"):
            raise ValueError(f"mode deve essere FULL o LORA, non {self.mode!r}")
        if self.precision not in PRECISIONS:
            raise ValueError(f"precision deve essere una di {PRECISIONS}, non {self.precision!r}")
        if self.optimizer not in OPTIMIZERS:
            raise ValueError(f"optimizer deve essere uno di {OPTIMIZERS}, non {self.optimizer!r}")
        if self.animation_mode not in ANIMATION_MODES:
            raise ValueError(f"animation_mode deve essere uno di {ANIMATION_MODES}")
        if not 1 <= self.steps <= 10:
            raise ValueError("steps per esempio deve stare fra 1 e 10 (latenza, non throughput)")
        if self.batch_size < 1 or self.max_seq_len < 2:
            raise ValueError("batch_size >= 1 e max_seq_len >= 2")
        if self.learning_rate <= 0 or self.lora_learning_rate <= 0:
            raise ValueError("learning rate deve essere > 0")
        if self.grad_clip < 0:
            raise ValueError("grad_clip non puo' essere negativo (0 = disattivato)")
        if not 0 <= self.lora.dropout < 1:
            raise ValueError("lora.dropout deve stare in [0, 1)")
        if self.lora.rank < 1:
            raise ValueError("lora.rank deve essere >= 1")
        if self.mode == "LORA" and not self.lora.target_modules:
            raise ValueError("lora.target_modules vuoto: nessun adapter da applicare")
        if len(self.history_prompts) != len(self.history_targets):
            raise ValueError("history_prompts e history_targets devono avere la stessa lunghezza")

    # ── I/O ──────────────────────────────────────────────────────────
    @classmethod
    def load(cls, path: str | Path | None = None) -> "Config":
        p = Path(path) if path else DEFAULT_CONFIG_PATH
        if not p.exists():
            return cls()
        return cls.from_dict(json.loads(p.read_text(encoding="utf-8")))

    def save(self, path: str | Path | None = None) -> Path:
        p = Path(path) if path else DEFAULT_CONFIG_PATH
        p.parent.mkdir(parents=True, exist_ok=True)
        self.validate()
        data = self.to_dict()
        data["checkpoint"] = self.relative_checkpoint()
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        return p
