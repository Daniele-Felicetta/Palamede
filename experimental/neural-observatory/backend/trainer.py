"""Palamede — Osservatorio: il ciclo di un singolo esempio.

Il contratto e' incrementale, non da dataset: un esempio entra, si fanno
`steps` optimizer step, si esce. Nessun `Trainer` di Hugging Face, nessuna
epoca, nessuno stato accumulato tra un esempio e l'altro.

Ordine di un update (e il perche'):

  1. tokenizzazione                      fuori dal cronometro GPU
  2. INFERENCE BEFORE   generazione greedy + loss   -> com'e' il modello
  3. snapshot           copia dei tensori trainabili -> serve il delta
  4. per ogni step:     forward -> loss -> backward -> grad clip -> step
                       -> statistiche (prima e dopo lo step)
  5. analisi            aggregazione moduli/layer + attivazioni + token
  6. INFERENCE AFTER    stesso prompt, greedy -> com'e' diventato

Le inferenze BEFORE/AFTER sono greedy (temperature 0): a parita' di prompt
l'unica variabile che cambia fra le due e' il peso. Se la generazione fosse
campionata, una differenza di testo non proverebbe niente.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import torch

from . import analyzer
from .analyzer import TensorStat, UpdateRecord
from .config import Config
from .metrics import RunTiming, StepTiming, Throughput, cuda_sync, throughput, vram
from .model import ModelHost

Emit = Callable[[str, dict[str, Any]], None]


class Trainer:
    """Un update incrementale alla volta, sul modello ospite."""

    def __init__(self, host: ModelHost, cfg: Config):
        self.host = host
        self.cfg = cfg
        self.graph: dict[str, Any] | None = None
        self.updates = 0
        self.history: list[UpdateRecord] = []
        self._weight_snapshots: dict[int, dict[str, torch.Tensor]] = {}
        self._last_step_deltas: dict[str, torch.Tensor] = {}

    # ── grafo ────────────────────────────────────────────────────────
    def set_graph(self, graph: dict[str, Any]) -> None:
        self.graph = graph

    def _groups(self) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, dict[str, Any]]]:
        """(per modulo, per nodo, metadati per nodo) presi dal grafo reale."""
        modules: dict[str, list[str]] = {}
        shapes: dict[str, dict[str, Any]] = {}
        if not self.graph:
            return modules, {}, shapes
        for m in self.graph["modules"]:
            modules[m["id"]] = m["params"]
        for n in self.graph["nodes"]:
            shapes[n["id"]] = {
                "label": n["label"], "kind": n["kind"], "layer": n["layer"],
                "layer_type": n["layer_type"], "params_count": n["numel"],
                "aliased": bool(n.get("params_aliased")),
            }
        return modules, {n["id"]: n["params"] for n in self.graph["nodes"]}, shapes

    def module_groups(self) -> dict[str, list[str]]:
        return self._groups()[0]

    def node_groups(self) -> dict[str, list[str]]:
        return self._groups()[1]

    # ── il ciclo ─────────────────────────────────────────────────────
    def update(self, prompt: str, target: str, steps: int | None = None,
               emit: Emit | None = None) -> dict[str, Any]:
        model = self.host.require()
        if self.graph is None:
            raise RuntimeError("grafo non impostato: chiama set_graph() dopo il caricamento")
        do: Emit = emit or (lambda _k, _v: None)
        n_steps = int(steps if steps is not None else self.cfg.steps)
        if not 1 <= n_steps <= 10:
            raise ValueError("steps deve stare fra 1 e 10")

        run = RunTiming()
        index = self.updates
        example_meta = {"prompt": prompt, "target": target}

        # ── 1. tokenizzazione ─────────────────────────────────────────
        t0 = time.perf_counter()
        ex = self.host.build_example(prompt, target)
        run.tokenize_ms = (time.perf_counter() - t0) * 1000.0
        if ex["n_target"] == 0:
            raise ValueError("il target deve contenere almeno un token oltre la lunghezza massima")

        # ── 2. inference BEFORE ───────────────────────────────────────
        self.host.set_capture(False)
        gen_before = self.host.generate(prompt)
        run.inference_before_ms = gen_before["seconds"] * 1000.0
        before = self.host.forward_loss(ex, need_attn=self.cfg.collect_attention)
        run.loss_before_ms = 0.0

        names = self.host.trainable_names()
        do("update_start", {
            "index": index, "prompt": prompt, "target": target,
            "steps": n_steps, "mode": self.cfg.mode,
            "tokens": ex["tokens"], "token_ids": ex["token_ids"],
            "n_prompt": ex["n_prompt"], "n_target": ex["n_target"],
            "prompt_tokens": ex["prompt_tokens"], "target_tokens": ex["target_tokens"],
            "loss_before": before["loss"], "perplexity_before": before["perplexity"],
            "output_before": gen_before["text"],
            "output_before_tokens": gen_before["tokens"],
            "inference_before_ms": run.inference_before_ms,
            "tokens_per_second": gen_before["tokens_per_second"],
            "trainable_tensors": len(names),
        })

        # ── 3. snapshot dei pesi trainabili ───────────────────────────
        t0 = time.perf_counter()
        snapshot = self.host.snapshot()
        run.tokenize_ms += (time.perf_counter() - t0) * 1000.0

        # ── 4. gli step ───────────────────────────────────────────────
        model.train()
        steps_detail: list[dict[str, Any]] = []
        per_step_stats: list[dict[str, TensorStat]] = []
        for step in range(1, n_steps + 1):
            st = StepTiming()
            if self.host.optimizer is None:
                self.host.rebuild_optimizer()
            # PRIMA del forward: l'hook del layer deve essere armato quando
            # l'attivazione passa, non dopo.
            if step == 1:
                self.host.set_capture(self.cfg.collect_activations)

            cuda_sync(self.host.device)
            t = time.perf_counter()
            with self.host._autocast():
                out = model(input_ids=ex["input_ids"], labels=ex["labels"], use_cache=False)
            loss = out.loss
            st.forward_ms = (time.perf_counter() - t) * 1000.0

            cuda_sync(self.host.device)
            t = time.perf_counter()
            loss.backward()
            st.backward_ms = (time.perf_counter() - t) * 1000.0

            gnorm_global = torch.nn.utils.clip_grad_norm_(
                [p for p in model.parameters() if p.grad is not None],
                self.cfg.grad_clip if self.cfg.grad_clip > 0 else float("inf"),
            )

            cuda_sync(self.host.device)
            t = time.perf_counter()
            self.host.optimizer.step()
            st.optimizer_ms = (time.perf_counter() - t) * 1000.0

            # Le statistiche si misurano con i gradienti ANCORA vivi: dopo
            # zero_grad(set_to_none=True) non c'e' piu' nulla da leggere.
            cuda_sync(self.host.device)
            t = time.perf_counter()
            stats = analyzer.measure_update(model, snapshot, names)
            st.analyze_ms = (time.perf_counter() - t) * 1000.0
            self.host.optimizer.zero_grad(set_to_none=True)
            per_step_stats.append(stats)

            layer_rows = analyzer.layer_gradient_profile(stats, self.node_groups())
            mod_rows = analyzer.add_contributions(
                analyzer.aggregate(stats, self.module_groups()), _total(stats, "delta_norm")
            )
            totals = _totals(stats)
            do("step", {
                "index": index, "step": step, "steps": n_steps,
                "loss": float(loss.item()),
                "perplexity": float(torch.exp(loss.detach().float()).item()),
                "grad_norm_global": float(gnorm_global),
                "timing": st.as_dict(),
                "layers": layer_rows,
                "modules": mod_rows,
                "totals": totals,
                "vram": vram(str(self.host.device)),
            })
            steps_detail.append({
                "step": step, "loss": float(loss.item()),
                "grad_norm_global": float(gnorm_global), "timing": st.as_dict(),
                "totals": totals,
            })
            run.steps.append(st)

        model.eval()
        final_stats = per_step_stats[-1]
        # Le attivazioni vanno LETTE prima di spegnere la cattura:
        # set_capture(False) libera i tensori, e leggerli dopo darebbe zero.
        activations = self.host.activation_stats() if self.cfg.collect_activations else {}
        per_token = self._token_payload(ex, final_stats) if self.cfg.collect_per_token else None
        self.host.set_capture(False)

        # ── 5. analisi finale ─────────────────────────────────────────
        t0 = time.perf_counter()
        modules = analyzer.add_contributions(
            analyzer.aggregate(final_stats, self.module_groups()), _total(final_stats, "delta_norm")
        )
        node_shapes = self._groups()[2]
        layers = analyzer.aggregate(final_stats, self.node_groups(), node_shapes,
                                    include_empty=True)
        analyzer.add_contributions(layers, _total(final_stats, "delta_norm"))
        for row in layers:
            row["label"] = node_shapes.get(row["id"], {}).get("label", row["id"])
        totals = _totals(final_stats)
        modules.sort(key=lambda r: -r["delta_norm"])
        run.analyze_ms = (time.perf_counter() - t0) * 1000.0

        # ── 6. inference AFTER ────────────────────────────────────────
        gen_after = self.host.generate(prompt)
        run.inference_after_ms = gen_after["seconds"] * 1000.0
        after = self.host.forward_loss(ex, need_attn=self.cfg.collect_attention)

        payload = {
            "index": index, "ts": time.time(),
            "example": example_meta,
            "tokens": ex["tokens"], "token_ids": ex["token_ids"],
            "n_prompt": ex["n_prompt"], "n_target": ex["n_target"],
            "prompt_tokens": ex["prompt_tokens"], "target_tokens": ex["target_tokens"],
            "mode": self.cfg.mode, "steps": n_steps,
            "loss_before": before["loss"], "loss_after": after["loss"],
            "perplexity_before": before["perplexity"], "perplexity_after": after["perplexity"],
            "output_before": gen_before["text"], "output_after": gen_after["text"],
            "output_before_tokens": gen_before["tokens"], "output_after_tokens": gen_after["tokens"],
            "timing": run.as_dict(),
            "vram": vram(str(self.host.device)),
            "throughput": {
                "generate_before": throughput(len(gen_before["token_ids"]), gen_before["seconds"]).as_dict(),
                "generate_after": throughput(len(gen_after["token_ids"]), gen_after["seconds"]).as_dict(),
            },
            "tensors": [analyzer.tensor_dict(s) for s in final_stats.values()],
            "modules": modules,
            "layers": layers,
            "steps_detail": steps_detail,
            "totals": totals,
            "activations": activations,
            "per_token": per_token,
            "attention": after.get("attention", {}),
            "precision_note": _precision_note(self.cfg, final_stats),
        }

        rec = UpdateRecord(
            index=index, ts=payload["ts"], example=example_meta, mode=self.cfg.mode,
            steps=n_steps, loss_before=before["loss"], loss_after=after["loss"],
            output_before=gen_before["text"], output_after=gen_after["text"],
            timing=payload["timing"], vram=payload["vram"],
            throughput=payload["throughput"],
            tensors=payload["tensors"], modules=modules, layers=layers,
            steps_detail=steps_detail, totals=totals,
        )
        rec.weights_ref = self._maybe_snapshot(index, model)
        self._record(rec)
        self.updates += 1
        payload["history_index"] = rec.index
        do("update_end", payload)
        del snapshot
        return payload

    # ── token view ───────────────────────────────────────────────────
    def _token_payload(self, ex: dict[str, Any], stats: dict[str, TensorStat]) -> dict[str, Any]:
        """Per-token: testo, posizione, perdita, entropia, hidden norm.

        Niente qui e' ricostruito: `loss` ed `entropy` vengono dal log-softmax
        dei logits reali, `hidden_norm` dall'uscita reale del layer (hook).
        """
        tok = self.host.tokenizer
        seq = ex["token_ids"]
        rows: list[dict[str, Any]] = []
        captured = self.host.captured_layers()
        per_layer_hidden: dict[str, list[float]] = {}
        for layer in captured:
            vals = self.host.per_token_hidden(layer)
            if vals:
                per_layer_hidden[str(layer)] = [round(v["norm"], 4) for v in vals]

        ent = self.host.per_token_entropy() or {}
        last = captured[-1] if captured else None
        last_norm = per_layer_hidden.get(str(last)) if last is not None else None

        for i, tid in enumerate(seq):
            rows.append({
                "i": i,
                "id": tid,
                "text": tok.decode([tid]),
                "is_target": i >= ex["n_prompt"],
                "norm": last_norm[i] if last_norm and i < len(last_norm) else None,
                "entropy": round(ent[i], 4) if i in ent else None,
            })
        return {
            "rows": rows,
            "per_layer_hidden": per_layer_hidden,
            "last_layer": last,
            "note": (
                "norm = norma del vettore hidden di quel token all'uscita del layer indicato; "
                "entropy = entropia del log-softmax degli hidden di quel layer, non dei logits."
            ),
        }

    # ── cronologia ───────────────────────────────────────────────────
    def _record(self, rec: UpdateRecord) -> None:
        self.history.append(rec)
        if len(self.history) > self.cfg.keep_history:
            drop = self.history[: len(self.history) - self.cfg.keep_history]
            self.history = self.history[len(self.history) - self.cfg.keep_history:]
            for d in drop:
                self._weight_snapshots.pop(d.weights_ref, None)

    def _maybe_snapshot(self, index: int, model: torch.nn.Module) -> int | None:
        keep = self.cfg.weight_snapshot_keep
        if keep <= 0:
            return None
        self._weight_snapshots[index] = {
            n: p.detach().to("cpu", copy=True)
            for n, p in model.named_parameters()
            if p.requires_grad
        }
        while len(self._weight_snapshots) > keep:
            self._weight_snapshots.pop(next(iter(self._weight_snapshots)))
        return index

    def compare(self, a: int, b: int) -> dict[str, Any]:
        ra = self.record(a)
        rb = self.record(b)
        out = analyzer.compare_records(ra, rb)
        sa, sb = self._weight_snapshots.get(ra.weights_ref or -1), self._weight_snapshots.get(rb.weights_ref or -1)
        if sa and sb and set(sa) == set(sb):
            out["exact_weight_distance"] = _weight_distance(sa, sb)
            out["exact_weight_distance_note"] = (
                "distanza L2 fra i pesi trainabili dei due update (snapshot reali)"
            )
        return out

    def record(self, index: int) -> UpdateRecord:
        for r in self.history:
            if r.index == index:
                return r
        raise KeyError(f"update {index} non in cronologia")

    def history_summaries(self) -> list[dict[str, Any]]:
        return [r.summary() for r in self.history]

    def clear_history(self) -> None:
        self.history.clear()
        self._weight_snapshots.clear()


def _total(stats: dict[str, TensorStat], key: str) -> float:
    if key == "delta_norm":
        return (sum(s.delta_norm ** 2 for s in stats.values())) ** 0.5
    if key == "grad_norm":
        return (sum((s.grad_norm or 0.0) ** 2 for s in stats.values())) ** 0.5
    return sum(getattr(s, key, 0.0) for s in stats.values())


def _totals(stats: dict[str, TensorStat]) -> dict[str, Any]:
    changed = sum(1 for s in stats.values() if s.changed)
    rounded = sum(1 for s in stats.values() if s.rounded_away)
    return {
        "tensors": len(stats),
        "params": sum(s.numel for s in stats.values()),
        "grad_norm": _total(stats, "grad_norm"),
        "grad_tensors": sum(1 for s in stats.values() if s.grad_norm is not None),
        "delta_norm": _total(stats, "delta_norm"),
        "changed_tensors": changed,
        "rounded_away_tensors": rounded,
        "max_rel_change_pct": max((s.rel_change_pct for s in stats.values()), default=0.0),
        "max_delta_absmax": max((s.delta_absmax for s in stats.values()), default=0.0),
    }


def _precision_note(cfg: Config, stats: dict[str, TensorStat]) -> str:
    n = sum(1 for s in stats.values() if s.rounded_away)
    if n == 0:
        return (f"precisione {cfg.precision}: nessun update e' andato perso per "
                f"arrotondamento ({cfg.compute_dtype or cfg.master_dtype} mantengono i delta).")
    return (f"precisione {cfg.precision}: {n} tensori hanno ricevuto gradiente ma il loro "
            f"delta si e' azzerato per arrotondamento (tutti RMSNorm: update ~1e-5 sotto la "
            f"risoluzione bf16 ~0.0039). Passa a precisione 'mixed' (fp32 master) per misurarli.")


def _weight_distance(a: dict[str, torch.Tensor], b: dict[str, torch.Tensor]) -> dict[str, float]:
    """Distanza L2 fra due set di pesi trainabili, aggregata per nome."""
    per: dict[str, float] = {}
    total_sq = 0.0
    for n in a:
        d = (a[n].float() - b[n].float())
        dn = float(d.norm())
        per[n] = dn
        total_sq += dn * dn
    return {"total": total_sq ** 0.5, "per_tensor": per}
