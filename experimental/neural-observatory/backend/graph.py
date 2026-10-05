"""Palamede — Osservatorio: topologia del grafo, letta dal modello reale.

Nessuna struttura scritta a mano: i nodi e i moduli sono derivati da
`config.layer_types` e dai `named_parameters()` effettivi del checkpoint. Se
un nome di parametro non e' riconosciuto viene riportato in `unclassified`
invece di essere scartato in silenzio: un grafo che mente e' peggio di un
grafo incompleto.

Le tre famiglie di nodi sono deliberatamente grossolane. Un nodo NON e' un
neurone: e' un GRUPPO DI PARAMETRI con un nome e una forma. La dicitura
"spessore = 1 tensor, non 1 neurone" finisce nella legenda del frontend.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Ruolo semantico del modulo. I tre pesi MLP hanno nomi interni w1/w3/w2 (non
# gate/up/down): la corrispondenza e' quella di Lfm2MLP, che con SwiGLU usa
# w1 come gate e w3 come up. `SEMANTIC_ROLE` dice come chiamarli nella UI e
# nella specifica di aggregazione; `raw` resta il nome vero del parametro.
SEMANTIC_ROLE: dict[str, str] = {
    "operator_norm": "norm_operator",
    "ffn_norm": "norm_ffn",
    "q_proj": "q", "k_proj": "k", "v_proj": "v", "out_proj": "o",
    "q_layernorm": "q_norm", "k_layernorm": "k_norm",
    "w1": "gate", "w3": "up", "w2": "down",
    "conv": "depthwise",
}

ROLE_LABELS: dict[str, str] = {
    "norm_operator": "Norm · operator",
    "norm_ffn": "Norm · ffn",
    "q": "Q", "k": "K", "v": "V", "o": "O",
    "q_norm": "norm Q", "k_norm": "norm K",
    "gate": "gate", "up": "up", "down": "down",
    "in_proj": "in_proj",
    "out_proj_conv": "out_proj",
    "out_proj": "out_proj",
    "depthwise": "conv (depthwise)",
}

GROUP_TITLES: dict[str, str] = {
    "attn": "Attention",
    "conv": "Short Conv",
    "feed_forward": "MLP (SwiGLU)",
    "norm": "Normalization",
}

# Il modulo del checkpoint si chiama `self_attn`, ma nella gerarchia che
# mostriamo (e nella legenda) e' un gruppo fra gli altri: "Attention".
GROUP_MAP: dict[str, str] = {"self_attn": "attn"}

GROUP_ABBR: dict[str, str] = {
    "attn": "attn",
    "conv": "conv",
    "feed_forward": "mlp",
    "norm": "norm",
}


def _classify(name: str) -> tuple[str, int | None, str]:
    """(scope, layer_index, module_id) per un nome di parametro reale."""
    parts = name.split(".")
    if len(parts) >= 2 and parts[0] == "model" and parts[1] == "layers":
        layer = int(parts[2])
        rest = parts[3:]
        if not rest:
            raise ValueError(f"parametro senza sottomodulo: {name}")
        if len(rest) == 2:  # es. operator_norm.weight
            module = f"norm.{rest[0].replace('_norm', '')}"
        else:  # es. self_attn.q_proj.weight
            module = f"{GROUP_MAP.get(rest[0], rest[0])}.{rest[1]}"
        return ("layer", layer, module)

    if parts[0] == "model" and parts[1] in ("embed_tokens", "embedding_norm"):
        return ("embedding", None, parts[1])
    if parts[0] == "lm_head":
        return ("lm_head", None, "lm_head")
    raise ValueError(f"parametro non classificato: {name}")


def _role_of(name: str) -> str:
    """Ruolo semantico di un parametro, non il suo nome grezzo."""
    parts = name.split(".")
    tail = parts[-2] if len(parts) >= 2 else parts[-1]
    parent = parts[-3] if len(parts) >= 3 else ""
    raw = tail
    if parent == "conv" and tail == "out_proj":
        raw = "out_proj_conv"
    return SEMANTIC_ROLE.get(raw, raw)


def _module_title(module_id: str) -> tuple[str, str]:
    """(gruppo, titolo leggibile) per un module_id."""
    raw_group = module_id.split(".")[0]
    group = GROUP_MAP.get(raw_group, raw_group)
    raw = module_id.split(".")[1]
    title = GROUP_TITLES.get(group, group)
    label = ROLE_LABELS.get(SEMANTIC_ROLE.get(raw, raw), raw)
    return title, f"{title} · {label}"


@dataclass
class GraphNode:
    id: str
    kind: str  # "embedding" | "layer" | "lm_head"
    label: str
    layer: int | None = None
    layer_type: str | None = None  # "conv" | "full_attention" | None
    params: list[str] = field(default_factory=list)
    numel: int = 0
    modules: list[str] = field(default_factory=list)
    params_aliased: bool = False  # i parametri sono un alias di un altro nodo


def build_graph(model: Any, cfg: Any) -> dict[str, Any]:
    """Costruisce il grafo da modello e config reali."""
    layer_types: list[str] = list(cfg.layer_types or ["full_attention"] * cfg.num_hidden_layers)
    # remove_duplicate=False: `lm_head.weight` e `model.embed_tokens.weight` sono
    # lo stesso tensor (lm_head tied) e il deduplicatore di PyTorch nasconderebbe
    # il nome. Senza questo il nodo LM Head non esisterebbe.
    params = {n: p for n, p in model.named_parameters(remove_duplicate=False)}

    nodes: dict[str, GraphNode] = {}
    module_index: dict[str, dict[str, Any]] = {}
    unclassified: list[str] = []
    tied: list[str] = []

    for name, p in params.items():
        try:
            scope, layer, module_id = _classify(name)
        except ValueError:
            unclassified.append(name)
            continue

        if scope == "layer":
            node_id = f"layer.{layer}"
            lt = layer_types[layer] if layer < len(layer_types) else "unknown"
        elif scope == "embedding":
            node_id, lt = "embeddings", None
        else:
            node_id, lt = "lm_head", None

        node = nodes.setdefault(
            node_id,
            GraphNode(
                id=node_id,
                kind=scope,
                label=("Embeddings" if node_id == "embeddings" else
                       "LM Head" if node_id == "lm_head" else
                       f"Layer {layer} · {'conv' if lt == 'conv' else 'attention'}"),
                layer=layer,
                layer_type=lt,
            ),
        )
        node.params.append(name)
        node.numel += p.numel()

        if scope != "layer":
            # Embeddings e LM head sono aggregati a se' stessi: non hanno
            # sotto-moduli da mostrare, i loro tensori stanno nel nodo.
            continue

        mod_id = f"{node_id}.{module_id}"
        mod = module_index.setdefault(
            mod_id,
            {
                "id": mod_id,
                "node": node_id,
                "layer": layer,
                "layer_type": lt,
                "group": module_id.split(".")[0],
                "role": _role_of(name),
                "param_role": module_id.split(".")[1],
                "group_title": _module_title(module_id)[0],
                "label": _module_title(module_id)[1],
                "params": [],
                "numel": 0,
            },
        )
        mod["params"].append(name)
        mod["numel"] += p.numel()
        if mod_id not in node.modules:
            node.modules.append(mod_id)

    # lm_head e' spesso lo STESSO tensor di embed_tokens (tied). Non e' un
    # parametro distinto: se lo lasciassimo com'e', l'update di quel tensor
    # verrebbe contato due volte nel totale. Il nodo LM Head resta visibile
    # (la specifica lo chiede) ma punta al nome reale del tensor e porta un
    # alias, cosi' l'inspector dice che e' la stessa matrice.
    tied: list[str] = []
    emb = nodes.get("embeddings")
    head = nodes.get("lm_head")
    if emb and head:
        head_tensor = params.get("lm_head.weight")
        emb_tensor = params.get("model.embed_tokens.weight")
        if head_tensor is not None and emb_tensor is not None and head_tensor.data_ptr() == emb_tensor.data_ptr():
            tied.append("lm_head.weight == model.embed_tokens.weight")
            head.numel = 0
            head.params = ["model.embed_tokens.weight"]
            head.params_aliased = True
        else:
            head.params_aliased = False

    order = ["embeddings"] + [f"layer.{i}" for i in range(len(layer_types))] + ["lm_head"]
    node_list = [nodes[i] for i in order if i in nodes]
    links = [
        {"from": a.id, "to": b.id, "kind": "residual"}
        for a, b in zip(node_list, node_list[1:])
    ]

    shapes = {n: list(p.shape) for n, p in params.items()}
    return {
        "model": {
            "name": "LFM2.5 230M",
            "model_type": cfg.model_type,
            "hidden_size": cfg.hidden_size,
            "intermediate_size": cfg.intermediate_size,
            "num_hidden_layers": cfg.num_hidden_layers,
            "num_attention_heads": cfg.num_attention_heads,
            "num_key_value_heads": cfg.num_key_value_heads,
            "vocab_size": cfg.vocab_size,
            "norm_eps": cfg.norm_eps,
            "conv_L_cache": cfg.conv_L_cache,
            "rope_theta": getattr(cfg, "rope_parameters", {}).get("rope_theta")
            if isinstance(getattr(cfg, "rope_parameters", None), dict) else None,
            "tie_word_embeddings": cfg.tie_word_embeddings,
            "layer_types": layer_types,
            "attn_layers": [i for i, t in enumerate(layer_types) if t == "full_attention"],
            "conv_layers": [i for i, t in enumerate(layer_types) if t == "conv"],
            "total_params": sum(p.numel() for p in params.values()),
            "unique_params": len({p.data_ptr() for p in params.values()}),
            "tied": tied,
        },
        "nodes": [
            {
                "id": n.id, "kind": n.kind, "label": n.label, "layer": n.layer,
                "layer_type": n.layer_type, "params": n.params, "numel": n.numel,
                "modules": n.modules, "params_aliased": n.params_aliased,
            }
            for n in node_list
        ],
        "modules": sorted(module_index.values(), key=lambda m: (m["layer"], m["id"])),
        "links": links,
        "shapes": shapes,
        "unclassified": unclassified,
        "disclaimer": (
            "Ogni nodo e' un gruppo di tensori di parametri (una matrice o un "
            "vettore di peso), non un neurone. La dimensione del nodo "
            "rappresenta il numero di parametri del gruppo."
        ),
    }
