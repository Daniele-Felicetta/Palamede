"""Palamede — Osservatorio: ospite del modello.

Un posto solo dove il checkpoint viene aperto, messo sulla GPU, passato a
bf16/fp32, vestito di LoRa e interrogato per le attivazioni. Trainer e
analizzatore non toccano torch direttamente: passano di qui.

Due scelte che vengono da misure, non da gusti:

1. `precision="mixed"` tiene i pesi in fp32 e fa il calcolo sotto
   `autocast(bf16)`. Con pesi in bf16 puro, 32 tensori su 132 (tutti gli
   RMSNorm) ricevono un update che non e' rappresentabile: 1e-5 su un valore
   vicino a 1.0 sta sotto la risoluzione di bf16 (2^-8 = 0.0039) e il delta
   si azzera. Un osservatorio che dichiara un delta che il peso non ha
   ricevuto mente per costruzione, quindi il default e' fp32 master.

2. Le mappe di attenzione esistono solo con `attn_implementation="eager"`:
   sdpa le rifiuta esplicitamente. Il costo misurato e' ~2.4 ms in piu' su
   una sequenza di 10 token, quindi quando le chiedi si accende eager e
   quando non le chiedi si torna a sdpa.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import torch
from torch import nn
from transformers import AutoModelForCausalLM, AutoTokenizer

from . import lora as lora_mod
from .config import Config
from .metrics import cuda_sync

_DTYPES = {"fp32": torch.float32, "bf16": torch.bfloat16, "fp16": torch.float16}


def _as_tensor(out: Any) -> torch.Tensor | None:
    """Estrae il tensor di uscita da un modulo che puo' restituire piu' forme."""
    if torch.is_tensor(out):
        return out
    for attr in ("last_hidden_state", "hidden_states", "logits"):
        v = getattr(out, attr, None)
        if torch.is_tensor(v):
            return v
    if isinstance(out, (tuple, list)):
        for v in out:
            if torch.is_tensor(v):
                return v
    return None


class ModelHost:
    """Checkpoint LFM2.5 230M caricato una volta e tenuto in memoria."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model: nn.Module | None = None
        self.tokenizer: Any = None
        self.hf_config: Any = None
        self.device = torch.device(cfg.device if torch.cuda.is_available() else "cpu")
        self.load_info: dict[str, Any] = {}
        self.lora_info: dict[str, Any] | None = None
        self.optimizer: torch.optim.Optimizer | None = None
        self._layer_hooks: list[Any] = []
        self._activations: dict[int, torch.Tensor] = {}
        self._capture = False
        self.optimizer_state: dict[str, Any] = {}

    # ── stato ────────────────────────────────────────────────────────
    @property
    def loaded(self) -> bool:
        return self.model is not None

    def require(self) -> nn.Module:
        if self.model is None:
            raise RuntimeError("modello non caricato: chiama load() prima")
        return self.model

    # ── caricamento ──────────────────────────────────────────────────
    def load(self) -> dict[str, Any]:
        """Apre tokenizer e pesi. Idempotente: se e' gia' carico non rifa."""
        if self.loaded:
            return self.load_info

        path = self.cfg.checkpoint_path
        if not path.exists():
            raise FileNotFoundError(f"checkpoint non trovato: {path}")

        t0 = time.perf_counter()
        self.tokenizer = AutoTokenizer.from_pretrained(path)
        self.hf_config = AutoConfig = __import__(
            "transformers", fromlist=["AutoConfig"]
        ).AutoConfig.from_pretrained(path)
        tokenize_ms = (time.perf_counter() - t0) * 1000.0

        # eager se l'utente vuole le mappe di attenzione, sdpa altrimenti
        impl = "eager" if self.cfg.collect_attention else "sdpa"
        master = _DTYPES[self.cfg.master_dtype]

        t1 = time.perf_counter()
        self.model = AutoModelForCausalLM.from_pretrained(
            path, dtype=master, attn_implementation=impl
        ).to(self.device)
        if self.device.type == "cuda":
            torch.backends.cuda.matmul.allow_tf32 = bool(self.cfg.precision == "fp32")
        load_ms = (time.perf_counter() - t1) * 1000.0

        self._install_layer_hooks()
        if self.cfg.mode == "LORA":
            self.lora_info = lora_mod.apply_lora(
                self.model,
                self.cfg.lora.target_modules,
                rank=self.cfg.lora.rank,
                alpha=self.cfg.lora.alpha,
                dropout=self.cfg.lora.dropout,
            )
        self.rebuild_optimizer()
        warm = self.warmup()

        params = dict(self.model.named_parameters())
        adapter_params = sum(
            p.numel() for n, p in params.items()
            if n.endswith(".lora_A") or n.endswith(".lora_B")
        )
        self.load_info = {
            "checkpoint": str(path),
            "load_ms": round(load_ms, 2),
            "tokenize_ms": round(tokenize_ms, 2),
            "attn_implementation": impl,
            "master_dtype": self.cfg.master_dtype,
            "compute_dtype": self.cfg.compute_dtype or self.cfg.master_dtype,
            "device": str(self.device),
            "model_type": self.hf_config.model_type,
            "hidden_size": self.hf_config.hidden_size,
            "intermediate_size": self.hf_config.intermediate_size,
            "num_hidden_layers": self.hf_config.num_hidden_layers,
            "layer_types": list(self.hf_config.layer_types or []),
            "attn_layers": [i for i, t in enumerate(self.hf_config.layer_types or []) if t == "full_attention"],
            "conv_layers": [i for i, t in enumerate(self.hf_config.layer_types or []) if t == "conv"],
            "tensors": len(params),
            # `total_params` in LoRA comprende gli adapter, quindi non e' piu'
            # il numero del checkpoint. `base_params` e' la cifra del modello,
            # `adapter_params` quello che LoRa aggiunge sopra.
            "total_params": sum(p.numel() for p in params.values()),
            "base_params": sum(p.numel() for p in params.values()) - adapter_params,
            "adapter_params": adapter_params,
            "unique_params": sum(
                p.numel() for p in {id(p): p for p in params.values()}.values()
            ),
            "trainable_params": sum(p.numel() for p in params.values() if p.requires_grad),
            "trainable_tensors": sum(1 for p in params.values() if p.requires_grad),
            "vocab_size": self.hf_config.vocab_size,
            "tie_word_embeddings": self.hf_config.tie_word_embeddings,
            "warmup": warm,
        }
        return self.load_info

    def warmup(self) -> dict[str, float]:
        """Una forward, una backward e una micro-generazione a vuoto.

        Senza questo la PRIMA richiesta dell'utente paga l'inizializzazione
        dei kernel CUDA: misurato fino a 13,6 s su questa macchina, contro
        ~220 ms a regime per la stessa generazione. Il warmup scatta quei
        kernel e poi ripristina i pesi, cosi' il modello torna esattamente
        quello appena caricato e l'utente non perde nulla.
        """
        model = self.require()
        tok = self.tokenizer
        snap = self.snapshot()
        was_training = model.training
        out: dict[str, float] = {}

        try:
            ids = torch.tensor([[1, 500, 1000]], dtype=torch.long, device=self.device)
            cuda_sync(self.device)
            t = time.perf_counter()
            with torch.no_grad(), self._autocast():
                model.generate(
                    input_ids=ids[:, :2], max_new_tokens=2, do_sample=False,
                    pad_token_id=tok.pad_token_id if tok.pad_token_id is not None else 0,
                )
            cuda_sync(self.device)
            out["generate_ms"] = round((time.perf_counter() - t) * 1000.0, 1)

            model.train()
            labels = ids.clone()
            cuda_sync(self.device)
            t = time.perf_counter()
            with self._autocast():
                loss = model(input_ids=ids, labels=labels, use_cache=False).loss
            loss.backward()
            cuda_sync(self.device)
            out["train_ms"] = round((time.perf_counter() - t) * 1000.0, 1)
            out["loss"] = round(float(loss.item()), 4)
        finally:
            self.restore(snap)
            model.zero_grad(set_to_none=True)
            if self.optimizer is not None:
                self.optimizer.state.clear()
            if not was_training:
                model.eval()
            del snap
        return out

    def unload(self) -> None:
        self._remove_layer_hooks()
        self.optimizer = None
        if self.model is not None:
            self.model.to("cpu")
            del self.model
        self.model = None
        self.tokenizer = None
        self.hf_config = None
        self.lora_info = None
        self.optimizer_state = {}
        self._activations = {}
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()

    # ── modalita' FULL / LORA ────────────────────────────────────────
    def reconfigure_mode(self, mode: str, lora_cfg: Any = None) -> dict[str, Any]:
        """Riapplica la modalita' da zero: FULL (tutto trainable) o LoRa.

        Idempotente e senza guard sul valore corrente: toglie gli adapter
        esistenti e ricostruisce tutto. Serve perche' un cambio di rank o
        alpha a modalita' invariata deve comunque rifare gli adapter, e un
        guard "la modalita' e' gia' questa" lo silenzierebbe, lasciando il
        modello apparentemente in LoRa ma con tutti i pesi base trainable.
        """
        if mode not in ("FULL", "LORA"):
            raise ValueError(f"mode deve essere FULL o LORA, non {mode!r}")
        model = self.require()
        if self.lora_info is not None:
            lora_mod.remove_lora(model)
            self.lora_info = None

        self.cfg.mode = mode
        if mode == "LORA":
            cfg = lora_cfg if lora_cfg is not None else self.cfg.lora
            self.lora_info = lora_mod.apply_lora(
                model,
                list(cfg.target_modules),
                rank=cfg.rank,
                alpha=cfg.alpha,
                dropout=cfg.dropout,
            )
        else:
            for p in model.parameters():
                p.requires_grad_(True)
        self.rebuild_optimizer()
        return self.mode_info()

    def set_mode(self, mode: str) -> dict[str, Any]:
        """Se la modalita' e' gia' quella, non rifa il lavoro."""
        if mode == self.cfg.mode:
            return self.mode_info()
        return self.reconfigure_mode(mode)

    def mode_info(self) -> dict[str, Any]:
        model = self.require()
        trainable = [n for n, p in model.named_parameters() if p.requires_grad]
        return {
            "mode": self.cfg.mode,
            "trainable_tensors": len(trainable),
            "trainable_params": sum(p.numel() for p in model.parameters() if p.requires_grad),
            "frozen_params": sum(p.numel() for p in model.parameters() if not p.requires_grad),
            "learning_rate": self.optimizer_state.get("lr"),
            "optimizer": self.cfg.optimizer,
            "lora": self.lora_info,
        }

    def rebuild_optimizer(self) -> None:
        """Ricrea l'optimizer sui soli tensori trainabili, con lo stato azzerato."""
        model = self.require()
        params = [p for p in model.parameters() if p.requires_grad]
        if not params:
            raise RuntimeError("nessun parametro trainabile: controlla mode e target_modules")
        lr = self.cfg.lora_learning_rate if self.cfg.mode == "LORA" else self.cfg.learning_rate
        name = self.cfg.optimizer.lower()
        if name == "adamw":
            self.optimizer = torch.optim.AdamW(params, lr=lr, weight_decay=0.0, eps=1e-8)
        elif name == "adam":
            self.optimizer = torch.optim.Adam(params, lr=lr, weight_decay=0.0, eps=1e-8)
        elif name == "sgd":
            self.optimizer = torch.optim.SGD(params, lr=lr, momentum=0.9)
        else:
            raise ValueError(f"optimizer sconosciuto: {self.cfg.optimizer}")
        self.optimizer_state = {
            "name": name, "lr": lr, "params": len(params),
            "grad_clip": self.cfg.grad_clip,
        }

    # ── snapshot dei pesi trainabili ─────────────────────────────────
    def snapshot(self) -> dict[str, torch.Tensor]:
        """Copia dei soli tensori trainabili, nel dtype master.

        Serve a calcolare il delta dopo l'optimizer step. In FULL sono ~230M
        valori: la copia occupa memoria, e' il prezzo della misura onesta.
        """
        return {
            n: p.detach().clone()
            for n, p in self.require().named_parameters()
            if p.requires_grad
        }

    def restore(self, snap: dict[str, torch.Tensor]) -> None:
        with torch.no_grad():
            for n, p in self.require().named_parameters():
                if n in snap:
                    p.copy_(snap[n])
        if self.optimizer is not None:
            self.optimizer.state.clear()

    # ── attivazioni per layer (hook reali) ───────────────────────────
    def _install_layer_hooks(self) -> None:
        """Un hook per decoder layer: cattura l'uscita reale di ognuno.

        Agganciare il ModuleList non funziona (nn.ModuleList non ha forward):
        va agganciato ogni layer. L'uscita puo' essere un tensor o un
        dataclass di transformers, quindi si passa da `_as_tensor`.
        """
        self._remove_layer_hooks()
        layers = self.require().model.layers
        for idx, layer in enumerate(layers):
            def hook(_mod, _inp, out, i=idx):
                if not self._capture:
                    return
                t = _as_tensor(out)
                if t is not None:
                    self._activations[i] = t.detach()
            self._layer_hooks.append(layer.register_forward_hook(hook))

    def _remove_layer_hooks(self) -> None:
        for h in self._layer_hooks:
            h.remove()
        self._layer_hooks.clear()

    def set_capture(self, on: bool) -> None:
        self._capture = on
        if not on:
            self._activations.clear()

    def activation_stats(self) -> dict[str, dict[str, float]]:
        """Per ogni layer: norma, media, deviazione e RMS dell'uscita reale."""
        out: dict[str, dict[str, float]] = {}
        for idx in sorted(self._activations):
            t = self._activations[idx].detach().float()
            out[str(idx)] = {
                "rms": float(t.pow(2).mean().sqrt()),
                "mean": float(t.mean()),
                "std": float(t.std()) if t.numel() > 1 else 0.0,
                "absmax": float(t.abs().max()),
                "norm": float(t.norm()),
                "shape": list(t.shape),
            }
        return out

    def per_token_hidden(self, layer: int | None = None) -> list[dict[str, float]] | None:
        """Per-token hidden norm: valori reali, uno per posizione di sequenza."""
        if layer is None:
            layer = max(self._activations) if self._activations else None
        if layer is None or layer not in self._activations:
            return None
        t = self._activations[layer].detach().float()
        if t.dim() == 3:
            t = t[0]
        norms = t.norm(dim=-1)
        return [{"norm": float(v), "absmax": float(t[i].abs().max())}
                for i, v in enumerate(norms)]

    def captured_layers(self) -> list[int]:
        """Indici dei layer che hanno davvero catturato un'uscita."""
        return sorted(self._activations)

    def per_token_entropy(self) -> dict[int, float] | None:
        """Entropia del log-softmax degli hidden per posizione.

        E' un dato derivato dagli hidden reali, non un softmax dei logits:
        la chiave `note` nel payload dice quale dei due e'.
        """
        if not self._activations:
            return None
        t = self._activations[max(self._activations)].detach().float()
        if t.dim() == 3:
            t = t[0]
        lp = torch.log_softmax(t, dim=-1)
        ent = -(lp.exp() * lp).sum(-1)
        return {i: float(v) for i, v in enumerate(ent.tolist())}

    # ── tokenizzazione ───────────────────────────────────────────────
    def build_example(self, prompt: str, target: str) -> dict[str, Any]:
        """Tokenizza prompt+target e maschera il prompt nella loss.

        La loss e' calcolata SOLO sui token del target: e' l'unica definizione
        di "impara questo esempio" che ha senso per un target esplicito.
        """
        tok = self.tokenizer
        p_ids = tok(prompt, return_tensors="pt", add_special_tokens=not self.cfg.add_bos).input_ids
        t_ids = tok(target, return_tensors="pt", add_special_tokens=False).input_ids
        ids = torch.cat([p_ids, t_ids], dim=1)[:, : self.cfg.max_seq_len]
        n_prompt = min(p_ids.shape[1], ids.shape[1])
        labels = ids.clone()
        labels[:, :n_prompt] = -100
        return {
            "input_ids": ids.to(self.device),
            "labels": labels.to(self.device),
            "n_prompt": n_prompt,
            "n_target": int(ids.shape[1]) - n_prompt,
            "tokens": [tok.decode([i]) for i in ids[0].tolist()],
            "token_ids": ids[0].tolist(),
            "prompt_tokens": [tok.decode([i]) for i in p_ids[0].tolist()[:n_prompt]],
            "target_tokens": [tok.decode([i]) for i in ids[0].tolist()[n_prompt:]],
        }

    # ── loss ─────────────────────────────────────────────────────────
    def forward_loss(self, ex: dict[str, Any], need_attn: bool = False) -> dict[str, Any]:
        """Forward con loss mascherata sul target. Restituisce anche i dettagli
        per token (loss, entropia) quando richiesti."""
        model = self.require()
        was_training = model.training
        model.eval()
        want_attn = need_attn and bool(self.cfg.collect_attention)
        with torch.no_grad():
            with self._autocast():
                out = model(
                    input_ids=ex["input_ids"],
                    labels=ex["labels"],
                    use_cache=False,
                    output_attentions=want_attn,
                )
        if was_training:
            model.train()

        loss = out.loss
        result: dict[str, Any] = {
            "loss": float(loss.item()),
            "perplexity": float(torch.exp(loss.detach().float()).item()),
            "logits_shape": list(out.logits.shape),
        }
        if self.cfg.collect_per_token:
            result["per_token"] = self._per_token_detail(ex, out.logits, loss)
        if want_attn and getattr(out, "attentions", None):
            result["attention"] = self._attention_payload(out.attentions)
        return result

    def _per_token_detail(self, ex: dict[str, Any], logits: torch.Tensor, loss: torch.Tensor) -> dict[str, Any]:
        """Loss ed entropia per posizione: solo dove la loss e' attiva."""
        lg = logits[0].float()
        logprobs = torch.log_softmax(lg, dim=-1)
        n_prompt = ex["n_prompt"]
        shift_lp = logprobs[:-1]
        shift_lbl = ex["labels"][0, 1:]
        mask = shift_lbl != -100
        ent = -(shift_lp.exp() * shift_lp).sum(-1)

        rows = []
        for pos in range(shift_lbl.shape[0]):
            if not bool(mask[pos]):
                continue
            rows.append({
                "pos": pos + 1,  # posizione nel target (1 = primo token target)
                "token_id": int(shift_lbl[pos]),
                "loss": float(-shift_lp[pos, shift_lbl[pos]]),
                "entropy": float(ent[pos]),
                "top1": int(shift_lp[pos].argmax()),
            })
        return {"rows": rows, "prompt_len": n_prompt, "seq_len": int(ex["input_ids"].shape[1])}

    def _attention_payload(self, attentions: Any) -> dict[str, Any]:
        """Mappe di attenzione reali, mediate sulle teste, solo se corte.

        Il payload tridimensionale (strati x teste x query x key) costerebbe
        troppo: si manda la media sulle teste e si dichiara la riduzione,
        tenendo la singola mappa a piena risoluzione.
        """
        layers = [a.detach().float() for a in attentions if a is not None]
        if not layers:
            return {}
        per_layer = {}
        for i, a in enumerate(layers):
            m = a[0].mean(0)  # (query, key)
            per_layer[str(i)] = {
                "matrix": [[round(float(v), 5) for v in row] for row in m],
                "key_mass": [round(float(v), 5) for v in m.sum(0)],
                "heads": int(a.shape[1]),
            }
        return {
            "reduction": "media sulle teste (heads): una mappa per layer di attenzione",
            "layers": per_layer,
        }

    # ── generazione ──────────────────────────────────────────────────
    @torch.no_grad()
    def generate(self, prompt: str, max_new_tokens: int | None = None) -> dict[str, Any]:
        """Generazione greedy. E' l'inferenza BEFORE/AFTER: stesso prompt,
        stesso seed, cosi' la differenza e' attribuibile ai pesi."""
        model = self.require()
        tok = self.tokenizer
        was_training = model.training
        model.eval()
        n = max_new_tokens if max_new_tokens is not None else self.cfg.max_new_tokens
        enc = tok(prompt, return_tensors="pt").input_ids.to(self.device)
        t0 = time.perf_counter()
        with self._autocast():
            out = model.generate(
                input_ids=enc,
                max_new_tokens=n,
                do_sample=self.cfg.temperature > 0,
                temperature=self.cfg.temperature if self.cfg.temperature > 0 else None,
                top_p=None,
                top_k=None,
                pad_token_id=tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id,
            )
        dt = time.perf_counter() - t0
        if was_training:
            model.train()
        new_ids = out[0][enc.shape[1]:].tolist()
        return {
            "text": tok.decode(new_ids, skip_special_tokens=True),
            "token_ids": new_ids,
            "tokens": [tok.decode([i]) for i in new_ids],
            "prompt_tokens": enc[0].tolist(),
            "seconds": dt,
            "tokens_per_second": len(new_ids) / dt if dt > 0 else 0.0,
        }

    # ── utilita' ─────────────────────────────────────────────────────
    def _autocast(self):
        """Contesto autocast: bf16 in 'mixed', vuoto negli altri casi."""
        dt = self.cfg.compute_dtype
        if dt is None or self.device.type != "cuda":
            from contextlib import nullcontext

            return nullcontext()
        return torch.autocast("cuda", dtype=_DTYPES[dt])

    def param_shapes(self) -> dict[str, list[int]]:
        return {n: list(p.shape) for n, p in self.require().named_parameters()}

    def trainable_names(self) -> list[str]:
        return [n for n, p in self.require().named_parameters() if p.requires_grad]
