"""Palamede — Osservatorio: analisi dei parametri e aggregazione a strati.

Misura, per ogni tensore trainabile, le due cose che contano in un update:
quanto era il gradiente e quanto si e' mosso il peso. Poi aggrega su moduli e
layer, perche' 132 matrici non si leggono e 16 strati si.

Regola di aggregazione: le norme si compongono in quadrato
(`sqrt(sum(n_i^2))`), non in somma. Sommare le norme darebbe un numero senza
significato e i layer grandi Sembrerebbero due volte piu' importanti.

Due avvertenze esplicite nei dati, non nella documentazione:
  - `rounded_away`: il gradiente c'era ma il delta e' nullo. In bf16 accade
    a tutti gli RMSNorm, perche' l'update (~1e-5) e' sotto la risoluzione del
    formato (~0.0039 per valori vicini a 1.0).
  - ogni aggregato porta `measured`, cosi' la UI puo' distinguere un valore
    misurato da uno che non e' disponibile.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

import torch


def _scalar(t: torch.Tensor) -> torch.Tensor:
    """Riduce a tensore 0-dim float32 senza materializzare il tensore intero.

    Le riduzioni su CUDA di torch accumulano in float32 anche per input
    bf16/fp16, quindi qui non serve (e non si deve) lanciare `.float()` sul
    tensore intero: per l'embeddings da 67M parametri costerebbe 268 MB.
    """
    return t.reshape(()).float()


@dataclass
class TensorStat:
    name: str
    shape: list[int]
    numel: int
    dtype: str
    # gradiente (dopo backward, prima dello step)
    grad_norm: float | None = None
    grad_mean: float | None = None
    grad_std: float | None = None
    grad_absmax: float | None = None
    # pesi
    weight_norm_before: float = 0.0
    weight_norm_after: float = 0.0
    # quanto si e' mosso
    delta_norm: float = 0.0
    delta_mean_abs: float = 0.0
    delta_absmax: float = 0.0
    rel_change_pct: float = 0.0
    changed: bool = False
    rounded_away: bool = False


def _stats_block(name: str, d: torch.Tensor, prefix: str) -> dict[str, torch.Tensor]:
    """Le 4 riduzioni di un tensori, come tensori 0-dim (nessun sync GPU).

    La chiave porta il nome del tensore: senza, 132 tensori si scrivono l'uno
    sull'altro sulla stessa chiave e tutte le statistiche tornano 0.
    """
    f = d.detach()
    out = {
        f"{name}__{prefix}_norm": _scalar(torch.linalg.vector_norm(f)),
        f"{name}__{prefix}_mean_abs": _scalar(f.abs().mean()) if f.numel() else _scalar(f.sum()),
        f"{name}__{prefix}_absmax": _scalar(f.abs().amax()) if f.numel() else _scalar(f.sum()),
    }
    # std: torch riduce in float32 internamente anche su input bf16/fp16, e
    # non va fatto .float() sul tensore intero (268 MB per l'embeddings).
    out[f"{name}__{prefix}_std"] = _scalar(f.std()) if f.numel() > 1 else out[f"{name}__{prefix}_norm"] * 0.0
    return out


def measure_update(
    model: torch.nn.Module,
    before: dict[str, torch.Tensor],
    names: list[str],
    grads: bool = True,
) -> dict[str, TensorStat]:
    """Statistiche per tensore dopo un optimizer step.

    Tutte le riduzioni vengono impilate e lette con UN solo `.cpu()`: 132
    tensori per 12 statistiche sono 1584 sincronizzazioni se le chiami una
    per una, e da sole costerebbero piu' dell'optimizer step.
    `grads=True` va chiamato PRIMA di `zero_grad(set_to_none=True)`: dopo, i
    gradienti non ci sono piu' e tutte le statistiche di gradiente tornano
    None. E' per questo che il trainer misura qui, non dopo lo zero_grad.
    """
    params = dict(model.named_parameters())
    live: dict[str, torch.Tensor] = {}
    scalars: dict[str, torch.Tensor] = {}
    shapes: dict[str, list[int]] = {}
    dtypes: dict[str, str] = {}
    has_grad: dict[str, bool] = {}
    low_precision: dict[str, bool] = {}

    for name in names:
        p = params.get(name)
        if p is None:
            continue
        shapes[name] = list(p.shape)
        dtypes[name] = str(p.dtype).replace("torch.", "")
        low_precision[name] = p.dtype in (torch.bfloat16, torch.float16)
        has_grad[name] = bool(grads and p.grad is not None)

        b = before.get(name)
        after = p.detach()
        if b is None:
            b = after
        # Delta nel dtype nativo quando e' fp32 (una sola copia temporanea
        # invece di due: per l'embeddings da 67M parametri sono 268 MB risparmiati
        # a ogni step). In bf16/fp16 si sale a fp32: misurare un delta ~1e-5
        # dentro un formato che non lo rappresenta darebbe uno zero falso.
        if b.dtype == after.dtype == torch.float32:
            d = after - b
        else:
            d = after.float() - b.float()

        live[name] = d
        scalars.update(_stats_block(name, b, "wb"))
        scalars.update(_stats_block(name, after, "wa"))
        scalars.update(_stats_block(name, d, "d"))
        if has_grad[name]:
            scalars.update(_stats_block(name, p.grad, "g"))
            scalars[f"{name}__gmean"] = _scalar(p.grad.detach().mean())

    # un solo trasferimento CPU per tutti gli scalari
    keys = sorted(scalars.keys())
    values = torch.stack([scalars[k] for k in keys]).cpu().tolist() if keys else []
    S = dict(zip(keys, values))

    stats: dict[str, TensorStat] = {}
    for name in names:
        if name not in shapes:
            continue
        d = live[name]
        st = TensorStat(
            name=name, shape=shapes[name], numel=int(d.numel()), dtype=dtypes[name],
            weight_norm_before=S.get(f"{name}__wb_norm", 0.0),
            weight_norm_after=S.get(f"{name}__wa_norm", 0.0),
            delta_norm=S.get(f"{name}__d_norm", 0.0),
            delta_mean_abs=S.get(f"{name}__d_mean_abs", 0.0),
            delta_absmax=S.get(f"{name}__d_absmax", 0.0),
        )
        if has_grad[name]:
            st.grad_norm = S.get(f"{name}__g_norm")
            st.grad_mean = S.get(f"{name}__gmean")
            st.grad_std = S.get(f"{name}__g_std")
            st.grad_absmax = S.get(f"{name}__g_absmax")
        wn = st.weight_norm_before
        st.rel_change_pct = (100.0 * st.delta_norm / wn) if wn > 0 else 0.0
        st.changed = st.delta_norm > 0.0
        st.rounded_away = (
            low_precision[name] and not st.changed and (st.grad_norm or 0.0) > 0.0
        )
        stats[name] = st
    return stats


def _l2(values: list[float]) -> float:
    return math.sqrt(sum(v * v for v in values if v))


def aggregate(
    stats: dict[str, TensorStat],
    groups: dict[str, list[str]],
    group_shapes: dict[str, dict[str, Any]] | None = None,
    include_empty: bool = False,
) -> list[dict[str, Any]]:
    """Aggrega le statistiche per modulo e per layer.

    `groups` mappa un id (module id o node id) alla lista dei tensori che gli
    appartengono. Le forme provengono dal grafo, quindi i moduli vuoti non
    vengono inventati.

    `include_empty=True` tiene anche i gruppi senza tensori trainabili, con
    `measured: false` e valori a zero. Serve per i NODI: in modalita' LoRa le
    embeddings e l'LM Head sono congelati, e senza questa opzione sparirebbero
    dalle barre per layer — la UI mostrerebbe solo 14 strati su 16 senza dire
    perche'. Meglio una riga a zero dichiarata che un buco.
    """
    out: list[dict[str, Any]] = []
    for gid, names in groups.items():
        present = [n for n in names if n in stats]
        if not present and not include_empty:
            continue
        if not present:
            row: dict[str, Any] = {
                "id": gid, "tensors": 0, "params": sum(
                    (len(n) for n in names), 0
                ), "grad_norm": 0.0, "grad_tensors": 0,
                "weight_norm_before": 0.0, "weight_norm_after": 0.0,
                "delta_norm": 0.0, "delta_mean_abs": 0.0, "delta_absmax": 0.0,
                "changed_tensors": 0, "rounded_away": 0, "measured": False,
            }
            row["rel_change_pct"] = 0.0
            if group_shapes and gid in group_shapes:
                row.update(group_shapes[gid])
                row["params"] = row.get("params_count", 0)
            out.append(row)
            continue
        s = [stats[n] for n in present]
        delta_sq = sum(st.delta_norm ** 2 for st in s)
        grad_sq = sum((st.grad_norm or 0.0) ** 2 for st in s)
        wb_sq = sum(st.weight_norm_before ** 2 for st in s)
        numel = sum(st.numel for st in s)
        row: dict[str, Any] = {
            "id": gid,
            "tensors": len(present),
            "params": numel,
            "grad_norm": _l2([st.grad_norm or 0.0 for st in s]),
            "grad_tensors": sum(1 for st in s if st.grad_norm is not None),
            "weight_norm_before": _l2([st.weight_norm_before for st in s]),
            "weight_norm_after": _l2([st.weight_norm_after for st in s]),
            "delta_norm": math.sqrt(delta_sq),
            "delta_mean_abs": sum(st.delta_mean_abs * st.numel for st in s) / numel if numel else 0.0,
            "delta_absmax": max((st.delta_absmax for st in s), default=0.0),
            "changed_tensors": sum(1 for st in s if st.changed),
            "rounded_away": sum(1 for st in s if st.rounded_away),
            "measured": True,
        }
        wb = row["weight_norm_before"]
        row["rel_change_pct"] = (100.0 * row["delta_norm"] / wb) if wb > 0 else 0.0
        if group_shapes and gid in group_shapes:
            row.update(group_shapes[gid])
        out.append(row)
    return out


def add_contributions(rows: list[dict[str, Any]], total: float) -> list[dict[str, Any]]:
    """Quota di ciascun gruppo sul totale dell'update, in percentuale.

    La quota e' la frazione del QUADRATO della norma: `‖δᵢ‖² / Σ‖δⱼ‖²`.
    E' l'unica forma che somma a 100% per costruzione. Dividere la norma
    lineare per la norma totale darebbe una somma pari al numero di gruppi
    (15 gruppi => 1500%), cioe' un grafico che non significa niente.

    Le righe con `aliased=True` non ricevono quota e restano fuori dal
    denominatore: il nodo LM Head punta allo stesso tensor di Embeddings
    (lm_head tied), e contarlo anche lui falserebbe il totale.
    """
    real = [r for r in rows if not r.get("aliased")]
    sq = sum(r["delta_norm"] ** 2 for r in real)
    base = sq if sq > 0 else (total ** 2 if total > 0 else 0.0)
    for r in rows:
        if r.get("aliased"):
            r["contribution_pct"] = None
        else:
            r["contribution_pct"] = (100.0 * (r["delta_norm"] ** 2) / base) if base > 0 else 0.0
    return rows


def layer_gradient_profile(
    stats: dict[str, TensorStat], node_params: dict[str, list[str]]
) -> list[dict[str, Any]]:
    """Il profilo per layer usato dalla barra `Layer 0 ░░░ / Layer 3 ███████`.

    E' il gradiente (non il delta): dice dove la loss sta spingendo, ed e'
    disponibile prima dello step.
    """
    rows = []
    for nid in sorted(node_params, key=lambda k: (not k.startswith("layer."), k)):
        present = [n for n in node_params[nid] if n in stats and stats[n].grad_norm is not None]
        if not present:
            continue
        rows.append({
            "id": nid,
            "label": nid.replace("layer.", "Layer "),
            "grad_norm": _l2([stats[n].grad_norm or 0.0 for n in present]),
            "delta_norm": _l2([stats[n].delta_norm for n in present]),
            "params": sum(stats[n].numel for n in present),
        })
    peak = max((r["grad_norm"] for r in rows), default=0.0)
    for r in rows:
        r["grad_pct_of_peak"] = (100.0 * r["grad_norm"] / peak) if peak > 0 else 0.0
    return rows


def normalize_rows(rows: list[dict[str, Any]], key: str) -> dict[str, float]:
    """Normalizza una metrica su 0..1 per il mapping visivo.

    Scala logaritmica: i gradienti di una rete vera sono distribuiti su ordini
    di grandezza diversi, e una scala lineare lascerebbe tutto nero tranne il
    layer di punta. Il ritorno e' 0..1 con `log1p`, dichiarato nella legenda.
    """
    import math as _m

    vals = [r.get(key, 0.0) or 0.0 for r in rows]
    if not vals:
        return {}
    vmax = max(vals)
    if vmax <= 0:
        return {r["id"]: 0.0 for r in rows}
    return {r["id"]: _m.log1p((r.get(key, 0.0) or 0.0)) / _m.log1p(vmax) for r in rows}


@dataclass
class UpdateRecord:
    """Una voce di cronologia: tutto il confrontabile di un update."""

    index: int
    ts: float
    example: dict[str, Any]
    mode: str
    steps: int
    loss_before: float
    loss_after: float
    output_before: str
    output_after: str
    timing: dict[str, Any]
    vram: dict[str, float]
    throughput: dict[str, Any]
    tensors: list[dict[str, Any]] = field(default_factory=list)
    modules: list[dict[str, Any]] = field(default_factory=list)
    layers: list[dict[str, Any]] = field(default_factory=list)
    steps_detail: list[dict[str, Any]] = field(default_factory=list)
    totals: dict[str, Any] = field(default_factory=dict)
    weights_ref: int | None = None  # indice snapshot su disco/ memoria

    def summary(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "ts": self.ts,
            "mode": self.mode,
            "steps": self.steps,
            "prompt": self.example.get("prompt", ""),
            "target": self.example.get("target", ""),
            "loss_before": self.loss_before,
            "loss_after": self.loss_after,
            "loss_delta": self.loss_after - self.loss_before,
            "output_before": self.output_before,
            "output_after": self.output_after,
            "output_changed": self.output_before != self.output_after,
            "total_ms": self.timing.get("total_ms", 0.0),
            "delta_norm": self.totals.get("delta_norm", 0.0),
            "grad_norm": self.totals.get("grad_norm", 0.0),
            "weights_ref": self.weights_ref,
        }


def tensor_dict(st: TensorStat) -> dict[str, Any]:
    return asdict(st)


def compare_records(a: UpdateRecord, b: UpdateRecord) -> dict[str, Any]:
    """Confronto A vs B su cio' che e' davvero registrato.

    La distanza parametrica vera si calcola solo se entrambi gli update hanno
    uno snapshot dei pesi: con la cronologia di sole statistiche il confronto
    resta su loss, delta per layer e output, e lo dice.
    """
    a_layers = {r["id"]: r for r in a.layers}
    b_layers = {r["id"]: r for r in b.layers}
    layer_rows = []
    for nid in sorted(set(a_layers) | set(b_layers)):
        la, lb = a_layers.get(nid, {}), b_layers.get(nid, {})
        da, db = la.get("delta_norm", 0.0), lb.get("delta_norm", 0.0)
        layer_rows.append({
            "id": nid,
            "label": la.get("label") or lb.get("label") or nid,
            "delta_norm_a": da, "delta_norm_b": db,
            "delta_norm_ratio": (db / da) if da > 0 else None,
            "grad_norm_a": la.get("grad_norm"), "grad_norm_b": lb.get("grad_norm"),
            "rel_change_pct_a": la.get("rel_change_pct"), "rel_change_pct_b": lb.get("rel_change_pct"),
        })

    return {
        "a": a.summary(),
        "b": b.summary(),
        "loss": {
            "before_a": a.loss_before, "after_a": a.loss_after,
            "before_b": b.loss_before, "after_b": b.loss_after,
            "gain_a": a.loss_before - a.loss_after,
            "gain_b": b.loss_before - b.loss_after,
        },
        "totals": {
            "delta_norm_a": a.totals.get("delta_norm"), "delta_norm_b": b.totals.get("delta_norm"),
            "grad_norm_a": a.totals.get("grad_norm"), "grad_norm_b": b.totals.get("grad_norm"),
        },
        "output": {
            "a_before": a.output_before, "a_after": a.output_after,
            "b_before": b.output_before, "b_after": b.output_after,
        },
        "layers": layer_rows,
        "exact_weight_distance": None,
        "exact_weight_distance_note": (
            "distanza parametrica non calcolata: serve uno snapshot dei pesi "
            "(imposta weight_snapshot_keep > 0)"
        ),
    }
