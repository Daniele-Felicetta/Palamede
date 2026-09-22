"""Palamede — fallback SDPA per Wan senza flash_attn (own code).

Il codice ufficiale Wan2.1 chiama ``flash_attention`` direttamente e fa
assert sulla presenza di flash_attn (non installabile qui senza nvcc).
Questo modulo fornisce un sostituto numericamente equivalente basato su
``torch.nn.functional.scaled_dot_product_attention`` e lo installa con
monkeypatch nel namespace del modello (``reference/`` resta intoccato).

Forme ufficiali: q/k/v [B, L, N, D], k_lens [B] opzionale (padding delle
chiavi), window_size (-1,-1) = attention piena per il 1.3B.
"""
from __future__ import annotations

import torch


def sdpa_flash_attention(
    q,
    k,
    v,
    q_lens=None,
    k_lens=None,
    dropout_p=0.0,
    softmax_scale=None,
    q_scale=None,
    causal=False,
    window_size=(-1, -1),
    deterministic=False,
    dtype=None,
    version=None,
):
    if q_scale is not None:
        q = q * q_scale
    b, lq, n, d = q.shape
    lk = k.shape[1]
    q_ = q.transpose(1, 2)  # [B, N, Lq, D]
    k_ = k.transpose(1, 2)
    v_ = v.transpose(1, 2)
    mask = None
    if k_lens is not None:
        keep = torch.arange(lk, device=k.device).unsqueeze(0) < k_lens.unsqueeze(1)
        mask = keep[:, None, None, :].expand(b, 1, lq, lk)
    out = torch.nn.functional.scaled_dot_product_attention(
        q_, k_, v_,
        attn_mask=mask,
        dropout_p=dropout_p,
        is_causal=causal if mask is None else False,
        scale=softmax_scale,
    )
    return out.transpose(1, 2)  # [B, Lq, N, D]


def apply_sdpa_fallback() -> None:
    """Sostituisce flash_attention con SDPA nel modulo modello Wan."""
    from wan.modules import model as wan_model

    wan_model.flash_attention = sdpa_flash_attention
