"""Palamede — Osservatorio: test reali sul checkpoint LFM2.5 230M.

Non sono test con mock: ogni assertion qui sotto passa attraverso i pesi veri
di `models/lfm/lfm2.5-230m`, un forward, un backward e un optimizer step.

  python experimental/neural-observatory/tests/test_observatory.py
"""

from __future__ import annotations

import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "experimental" / "neural-observatory"))

import torch  # noqa: E402

from backend import analyzer, graph, lora  # noqa: E402
from backend.config import Config  # noqa: E402
from backend.metrics import gpu_info, vram  # noqa: E402
from backend.model import ModelHost  # noqa: E402
from backend.trainer import Trainer  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, fn):
    t0 = time.perf_counter()
    try:
        detail = fn() or ""
        RESULTS.append((name, True, f"{detail} ({time.perf_counter()-t0:.1f}s)"))
        print(f"  [ok]   {name}  {detail}  ({time.perf_counter()-t0:.1f}s)", flush=True)
    except Exception as exc:  # noqa: BLE001
        tb = traceback.format_exc(limit=4)
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"  [FAIL] {name}\n{tb}", flush=True)


def main() -> int:
    cfg = Config()
    cfg.steps = 2
    cfg.max_new_tokens = 8
    cfg.max_seq_len = 32

    print("=== 1. MODEL ===")
    assert cfg.checkpoint_path.exists(), f"checkpoint mancante: {cfg.checkpoint_path}"
    host = ModelHost(cfg)
    info = host.load()
    print(f"  checkpoint {info['checkpoint']}")
    print(f"  {info['total_params']:,} param ({info['unique_params']:,} unici) su {info['device']}")

    def t_param_count():
        assert info["total_params"] == 229_693_184, info["total_params"]
        assert info["unique_params"] == 229_693_184, "lm_head non e' tied come dichiarato"
        assert 228e6 < info["total_params"] < 232e6, "non e' un modello da 230M"
        return f"{info['total_params']:,} param, {info['tensors']} tensori"

    check("modello caricato e conteggio parametri verificato", t_param_count)

    def t_arch():
        lt = info["layer_types"]
        assert len(lt) == 14, lt
        assert info["attn_layers"] == [2, 4, 6, 8, 10, 12], info["attn_layers"]
        assert info["conv_layers"] == [0, 1, 3, 5, 7, 9, 11, 13], info["conv_layers"]
        return f"14 layer ibridi: {len(info['attn_layers'])} attention + {len(info['conv_layers'])} conv"

    check("architettura ibrida reale (conv + attention) letta da config", t_arch)

    def t_gpu():
        g = gpu_info("cuda")
        assert g["available"], "serve CUDA per l'osservatorio"
        return f"{g['name']} {g['total_mib']:.0f} MiB, bf16={g['bf16']}"

    check("CUDA disponibile", t_gpu)

    def t_inference():
        out = host.generate("The cat sat on the", max_new_tokens=8)
        assert out["token_ids"], "nessun token generato"
        assert out["tokens_per_second"] > 0
        return f"{len(out['token_ids'])} tok in {out['seconds']*1e3:.0f}ms = {out['tokens_per_second']:.1f} tok/s"

    check("inference funzionante", t_inference)

    print("\n=== 2. GRAFO ===")
    g = graph.build_graph(host.require(), host.hf_config)
    tr = Trainer(host, cfg)
    tr.set_graph(g)

    def t_graph():
        kinds = [n["kind"] for n in g["nodes"]]
        assert kinds[0] == "embedding" and kinds[-1] == "lm_head", kinds
        assert len(g["nodes"]) == 16, len(g["nodes"])
        assert not g["unclassified"], f"parametri non classificati: {g['unclassified']}"
        covered = {p for n in g["nodes"] for p in n["params"]}
        allp = set(host.param_shapes())
        assert covered == allp, f"coperti {len(covered)} su {len(allp)}: mancano {allp - covered}"
        # il nodo LM Head e' un alias: non puo' contare parametri due volte
        head = g["nodes"][-1]
        assert head["params_aliased"] is True and head["numel"] == 0, head
        assert g["model"]["tied"], "lm_head non e' dichiarato tied"
        tot = sum(n["numel"] for n in g["nodes"])
        assert tot == info["total_params"], (tot, info["total_params"])
        return (f"{len(g['nodes'])} nodi, {len(g['modules'])} moduli, tutti i parametri "
                f"classificati, LM Head alias (totale {tot:,} senza doppio conteggio)")

    check("topologia 3D derivata dal checkpoint, nessun parametro perso", t_graph)

    def t_groups():
        conv_mods = [m for m in g["modules"] if m["layer"] == 0]
        attn_mods = [m for m in g["modules"] if m["layer"] == 2]
        roles_conv = {m["role"] for m in conv_mods}
        roles_attn = {m["role"] for m in attn_mods}
        assert "in_proj" in roles_conv and "depthwise" in roles_conv, roles_conv
        assert not (roles_conv & {"q", "k", "v", "o"}), f"layer conv con attenzione: {roles_conv}"
        assert {"q", "k", "v", "o"} <= roles_attn, roles_attn
        for mods in (conv_mods, attn_mods):
            assert {"gate", "up", "down"} <= {m["role"] for m in mods}, mods
        # i nomi grezzi dei pesi MLP devono restare visibili
        raws = {m["param_role"] for m in conv_mods if m["group"] == "feed_forward"}
        assert raws == {"w1", "w2", "w3"}, raws
        # ogni layer conv ha short-conv, ogni layer attn ha Q/K/V/O
        for n in g["nodes"]:
            if n["kind"] != "layer":
                continue
            mods = [m for m in g["modules"] if m["layer"] == n["layer"]]
            has_conv = any(m["group"] == "conv" for m in mods)
            has_attn = any(m["group"] == "attn" for m in mods)
            assert has_conv != has_attn, f"layer {n['layer']}: conv={has_conv} attn={has_attn}"
        return (f"L0 conv: {sorted(roles_conv)} | L2 attn: {sorted(roles_attn)} | "
                f"SwiGLU gate/up/down ovunque, 8 conv + 6 attn alternati")

    check("aggregazione layer adattata a LFM2 (non struttura Llama)", t_groups)

    print("\n=== 3. TRAINING ===")

    def t_update():
        p = tr.update("Il gatto dorme sul", " tappeto", steps=2)
        assert p["loss_after"] < p["loss_before"], (p["loss_before"], p["loss_after"])
        return (f"loss {p['loss_before']:.4f} -> {p['loss_after']:.4f} in {p['timing']['total_ms']:.0f}ms "
                f"({p['timing']['mean_step_ms']:.0f}ms/step)")

    check("forward + backward + optimizer step: la loss scende", t_update)

    def t_changed():
        p = tr.update("La capitale d'Italia e'", " Roma", steps=1)
        t = p["tensors"]
        assert len(t) == 132, len(t)
        changed = [x for x in t if x["changed"]]
        assert len(changed) > 100, f"solo {len(changed)}/132 tensori cambiati"
        assert p["totals"]["rounded_away_tensors"] == 0, "delta azzerati: usa precisione mixed"
        return f"{len(changed)}/132 tensori cambiati, 0 arrotondati via"

    check("almeno un parametro cambia davvero (e nessuno si azzera)", t_changed)

    def t_analysis():
        p = tr.update("Il mare e'", " blu", steps=1)
        ts = {x["name"]: x for x in p["tensors"]}
        q = ts["model.layers.2.self_attn.q_proj.weight"]
        for k in ("grad_norm", "weight_norm_before", "weight_norm_after", "delta_norm",
                  "delta_mean_abs", "delta_absmax", "rel_change_pct", "shape", "numel"):
            assert q[k] is not None, f"{k} mancante su q_proj"
        assert q["grad_norm"] >= 0 and q["delta_norm"] >= 0
        assert 0 <= q["rel_change_pct"] < 100, q["rel_change_pct"]
        layers = {x["id"]: x for x in p["layers"]}
        assert len(layers) == 16, len(layers)
        real = [x for x in p["layers"] if not x["aliased"]]
        aliased = [x for x in p["layers"] if x["aliased"]]
        assert len(aliased) == 1 and aliased[0]["id"] == "lm_head", aliased
        assert aliased[0]["contribution_pct"] is None, "un alias non deve avere una quota"
        assert abs(sum(x["contribution_pct"] for x in real) - 100) < 1e-6, \
            f"quote sommano a {sum(x['contribution_pct'] for x in real)}"
        tot = sum(x["params"] for x in real)
        assert tot == info["total_params"], (tot, info["total_params"])
        return (f"q_proj grad {q['grad_norm']:.4f} delta {q['delta_norm']:.5f} "
                f"rel {q['rel_change_pct']:.4f}% | 16 nodi (15 reali + LM Head alias), "
                f"quote sommano a 100%")

    check("statistiche gradienti/delta valide e aggregazione layer coerente", t_analysis)

    def t_timing():
        p = tr.update("Due piu due fa", " quattro", steps=1)
        t = p["timing"]["steps"][0]
        for k in ("forward_ms", "backward_ms", "optimizer_ms", "total_ms"):
            assert t[k] > 0, f"{k} non misurato"
        return (f"fwd {t['forward_ms']:.0f}ms bwd {t['backward_ms']:.0f}ms "
                f"opt {t['optimizer_ms']:.0f}ms | inf-before {p['timing']['inference_before_ms']:.0f}ms")

    check("tempi reali per fase (forward/backward/optimizer/ inference)", t_timing)

    def t_vram():
        p = tr.update("Uno", " due", steps=1)
        assert p["vram"]["max_allocated_mib"] > 0
        assert p["throughput"]["generate_before"]["tokens_per_second"] > 0
        return (f"picco {p['vram']['max_allocated_mib']:.0f} MiB, "
                f"{p['throughput']['generate_before']['tokens_per_second']:.1f} tok/s")

    check("VRAM e token/s misurati", t_vram)

    def t_activations():
        p = tr.update("Nel mezzo", " del cammin", steps=1)
        a = p["activations"]
        assert len(a) == 14, f"attivazioni su {len(a)} layer invece di 14"
        for i in ("0", "2", "13"):
            assert a[i]["rms"] > 0, f"layer {i} senza attivazione"
        pt = p["per_token"]
        assert pt and len(pt["rows"]) == len(p["tokens"]), pt
        assert pt["last_layer"] == 13, pt["last_layer"]
        assert pt["rows"][0]["is_target"] is False and pt["rows"][-1]["is_target"] is True
        return (f"14 layer agganciati, ultimo hidden RMS {a['13']['rms']:.2f}, "
                f"{len(pt['rows'])} token con norm+entropia")

    check("attivazioni per layer e per token realmente catturate", t_activations)

    def t_attention():
        p = tr.update("Il cane", " abbaia", steps=1)
        att = p["attention"]
        assert att, "nessuna mappa di attenzione (serve collect_attention e attn eager)"
        assert len(att["layers"]) == 6, f"{len(att['layers'])} layer di attenzione invece di 6"
        for i, lay in att["layers"].items():
            for row in lay["matrix"]:
                assert abs(sum(row) - 1.0) < 0.02, "riga di attenzione non normalizzata"
        return f"{len(att['layers'])} mappe reali (media su {list(att['layers'].values())[0]['heads']} teste)"

    check("mappe di attenzione vere (QK), non simulate", t_attention)

    print("\n=== 4. LoRA ===")
    host.unload()
    lcfg = Config()
    lcfg.mode = "LORA"
    lcfg.lora.rank = 8
    lcfg.steps = 2
    host2 = ModelHost(lcfg)
    host2.load()
    tr2 = Trainer(host2, lcfg)
    tr2.set_graph(graph.build_graph(host2.require(), host2.hf_config))

    def t_lora():
        li = host2.lora_info
        assert li is not None and li["adapters"] > 0, "nessun adapter applicato"
        assert li["base_frozen"] is True, "il modello base non e' congelato"
        assert li["trainable_params"] < info["total_params"] * 0.1, li["trainable_params"]
        assert not li["missing_targets"], f"target inesistenti: {li['missing_targets']}"
        return (f"{li['adapters']} adapter, {li['trainable_params']:,} param trainabili "
                f"({100*li['trainable_params']/info['total_params']:.2f}%), base congelata")

    check("LoRa: base congelata e adapter applicati ai target giusti", t_lora)

    def t_lora_train():
        p = tr2.update("Il gatto dorme sul", " tappeto", steps=2)
        assert p["loss_after"] < p["loss_before"]
        changed = [x for x in p["tensors"] if x["changed"]]
        assert changed, "nessun adapter aggiornato"
        assert all(".lora_A" in x["name"] or ".lora_B" in x["name"] for x in changed), \
            "si e' mosso qualcosa che non e' un adapter"
        b = [x for x in changed if ".lora_B" in x["name"]]
        return (f"loss {p['loss_before']:.4f} -> {p['loss_after']:.4f}, "
                f"{len(changed)} adapter cambiati ({len(b)} matrici B uscite da zero)")

    check("LoRa: i parametri dell'adapter vengono aggiornati", t_lora_train)

    def t_lora_base():
        base = {n: p for n, p in host2.require().named_parameters()
                if not n.endswith((".lora_A", ".lora_B"))}
        assert base, "modello base assente"
        moved = [n for n, p in base.items() if p.requires_grad]
        assert not moved, f"tensore base trainabile: {moved[:3]}"
        return f"{len(base)} tensori base tutti requires_grad=False"

    check("LoRa: i pesi base restano davvero fermi", t_lora_base)

    print("\n=== 5. STORIA ===")

    def t_history():
        s = tr.history_summaries()
        assert len(s) >= 4, len(s)
        for r in s:
            assert r["index"] >= 0 and "loss_before" in r and "delta_norm" in r
        return f"{len(s)} update in cronologia (indici {s[0]['index']}..{s[-1]['index']})"

    check("cronologia registrata", t_history)

    def t_compare():
        a, b = tr.history_summaries()[0]["index"], tr.history_summaries()[-1]["index"]
        c = tr.compare(a, b)
        assert len(c["layers"]) == 16
        assert "exact_weight_distance" in c
        return (f"confronto #{a} vs #{b}: {len(c['layers'])} layer, "
                f"guadagno A {c['loss']['gain_a']:.3f} / B {c['loss']['gain_b']:.3f}, "
                f"distanza pesi {'calcolata' if c['exact_weight_distance'] else 'non calcolata (dichiarato)'}")

    check("time travel: confronto fra due update", t_compare)

    def t_weight_snapshots():
        lcfg.weight_snapshot_keep = 2
        before = len(tr2._weight_snapshots)
        tr2.update("A", " B", steps=1)
        tr2.update("C", " D", steps=1)
        assert len(tr2._weight_snapshots) <= 2, len(tr2._weight_snapshots)
        lcfg.weight_snapshot_keep = 0
        return f"snapshot pesi limitati a 2 (era {before}), rotazione ok"

    check("snapshot pesi con limite (default 0 = solo statistiche)", t_weight_snapshots)

    print("\n=== 6. PRECISIONE ===")

    def t_bf16_warning():
        bcfg = Config()
        bcfg.precision = "bf16"
        bcfg.steps = 1
        bcfg.max_new_tokens = 4
        h = ModelHost(bcfg)
        h.load()
        t3 = Trainer(h, bcfg)
        t3.set_graph(graph.build_graph(h.require(), h.hf_config))
        p = t3.update("Uno", " due", steps=1)
        n = p["totals"]["rounded_away_tensors"]
        h.unload()
        assert n > 0, "in bf16 nessun update dovrebbe azzerarsi: la nota mentirebbe"
        assert "arrotondamento" in p["precision_note"]
        return f"bf16 puro: {n}/132 tensori con gradiente azzerati, dichiarati nel payload"

    check("modalita' bf16 dichiara i delta persi invece di nasconderli", t_bf16_warning)

    host2.unload()
    host.unload()

    print("\n" + "=" * 74)
    ok = sum(1 for _, p, _ in RESULTS if p)
    bad = [n for n, p, _ in RESULTS if not p]
    print(f"RISULTATO: {ok}/{len(RESULTS)} verifiche passate")
    if bad:
        print("FALLITE:")
        for n in bad:
            print("  -", n)
    print(f"VRAM finale: {vram()}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
