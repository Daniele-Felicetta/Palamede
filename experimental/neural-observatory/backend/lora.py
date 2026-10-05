"""Palamede — Osservatorio: LoRa scritto a mano, niente peft.

Motivazione (e non una scorciatoia): il venv che gira l'osservatorio non ha
`peft`, e la rete di lavoro non permette di installarlo (certificato TLS
intercettato => ogni `pip install` fallisce). Un adapter LoRa sono due
matrici: `A` (r x in) inizializzata a Kaiming e `B` (out x r) a ZERO, cosi'
il modello all'avvio e' esattamente il modello base.

Vantaggio per un osservatorio: `A` e `B` sono tensori normali, con nome,
forma e gradiente. L'analizzatore li misura come qualunque altro parametro e
l'ispector li mostra uno per uno.

Una differenza da peft che dichiariamo: qui `lora_dropout` e' un
`nn.Dropout` applicato all'ingresso di `A`, quindi i suoi tensori non
esistono e non sono ispezionabili. Il resto della semantica (alpha/r come
scala, `B` a zero, base congelata) coincide con LoRa standard.
"""

from __future__ import annotations

import math

import torch
from torch import nn


class LoRALinear(nn.Module):
    """Linear avvolto da un adapter LoRa a basso rango. Base congelata."""

    def __init__(self, base: nn.Linear, rank: int, alpha: float, dropout: float = 0.0):
        super().__init__()
        if rank < 1:
            raise ValueError(f"rank LoRa deve essere >= 1, non {rank}")
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)

        self.rank = rank
        self.alpha = float(alpha)
        self.scaling = self.alpha / rank
        self.dropout_p = float(dropout)
        self.in_features = base.in_features
        self.out_features = base.out_features

        dtype, device = base.weight.dtype, base.weight.device
        # Kaiming su A come in LoRa (non zero-init: cosi' A ha gradiente
        # subito), B a zero cosi' il contributo dell'adapter parte da 0.
        self.lora_A = nn.Parameter(torch.empty(rank, base.in_features, dtype=dtype, device=device))
        self.lora_B = nn.Parameter(torch.zeros(base.out_features, rank, dtype=dtype, device=device))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        self.lora_dropout = nn.Dropout(self.dropout_p) if self.dropout_p > 0 else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.base(x)
        h = self.lora_dropout(x)
        return out + (h @ self.lora_A.transpose(0, 1) @ self.lora_B.transpose(0, 1)) * self.scaling

    def extra_repr(self) -> str:
        return f"rank={self.rank}, alpha={self.alpha:g}, scaling={self.scaling:g}, dropout={self.dropout_p:g}"


def _iter_named_linears(module: nn.Module):
    """(parent, child_name, child) per ogni Linear, senza scendere nei figli."""
    for parent in module.modules():
        for name, child in list(parent.named_children()):
            if isinstance(child, nn.Linear):
                yield parent, name, child


def apply_lora(
    model: nn.Module,
    target_modules: list[str],
    rank: int = 16,
    alpha: float = 32.0,
    dropout: float = 0.0,
) -> dict[str, object]:
    """Congela il modello e avvolge i target con LoRALinear.

    Restituisce un riassunto con il numero di adapter, i nomi reali dei
    tensori e la lista dei target richiesti che NON esistono nel modello
    (perche' segnalarli e' piu' onesto che ignorarli in silenzio).
    """
    targets = set(target_modules)
    for p in model.parameters():
        p.requires_grad_(False)

    wrapped: list[str] = []
    for parent, name, child in _iter_named_linears(model):
        if name not in targets:
            continue
        adapter = LoRALinear(child, rank=rank, alpha=alpha, dropout=dropout)
        setattr(parent, name, adapter)
        wrapped.append(f"{name}")

    full_names = set()
    for parent_name, parent in model.named_modules():
        for name, child in parent.named_children():
            if isinstance(child, LoRALinear):
                full_names.add(f"{parent_name}.{name}" if parent_name else name)

    trainable = [n for n, p in model.named_parameters() if p.requires_grad]
    trainable_numel = sum(p.numel() for p in model.parameters() if p.requires_grad)
    frozen = sum(p.numel() for p in model.parameters() if not p.requires_grad)

    base_params = [n for n, _ in model.named_parameters() if not n.endswith((".lora_A", ".lora_B"))]

    return {
        "mode": "LORA",
        "rank": rank,
        "alpha": alpha,
        "dropout": dropout,
        "scaling": alpha / rank,
        "target_modules": sorted(targets),
        "adapters": len(full_names),
        "adapter_modules": sorted(full_names),
        "missing_targets": sorted(targets - {n.split(".")[-1] for n in full_names}),
        "trainable_tensors": trainable,
        "trainable_params": trainable_numel,
        "frozen_params": frozen,
        "base_tensors": len(base_params),
        "base_frozen": all(
            not p.requires_grad for n, p in model.named_parameters()
            if not (n.endswith(".lora_A") or n.endswith(".lora_B"))
        ),
    }


def remove_lora(model: nn.Module) -> int:
    """Rimuove gli adapter e restituisce il solo modello base. n = adapter rimossi."""
    removed = 0
    for parent in model.modules():
        for name, child in list(parent.named_children()):
            if isinstance(child, LoRALinear):
                setattr(parent, name, child.base)
                removed += 1
    return removed


def lora_delta_contribution(adapter: LoRALinear, x: torch.Tensor) -> torch.Tensor:
    """Quello che l'adapter aggiunge all'uscita di `x` (per l'inspector)."""
    h = adapter.lora_dropout(x)
    return (h @ adapter.lora_A.transpose(0, 1) @ adapter.lora_B.transpose(0, 1)) * adapter.scaling
