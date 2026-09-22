"""Palamede — T5 Wan (chiavi originali) -> GGUF arch t5encoder (own code).

Mappa le chiavi stile Wan ai nomi standard attesi dal loader t5encoder di
llama.cpp ufficiale (stesse forme/orientamenti dei GGUF umt5 ufficiali) e
incorpora il vocab dallo spiece/tokenizer.json LOCALE (niente download).

Uso:
  python scripts/t5_to_t5encoder_gguf.py \
    --src C:/.../models_t5_umt5-xxl-enc-bf16.pth \
    --tokdir C:/.../models/wan2.1-t2v-1.3b/google/umt5-xxl \
    --dst C:/.../umt5-t5encoder-F16.gguf
"""
import argparse
import json
import os
import re
import sys

import gguf
import numpy as np
import torch

# Wan key -> gguf name
def map_name(key: str) -> str | None:
    if key == "token_embedding.weight":
        return "token_embd.weight"
    if key == "norm.weight":
        return "enc.output_norm.weight"
    m = re.fullmatch(r"blocks\.(\d+)\.(.+)\.weight", key)
    if not m:
        return None
    n, rest = m.group(1), m.group(2)
    table = {
        "norm1": "attn_norm",
        "attn.q": "attn_q", "attn.k": "attn_k",
        "attn.v": "attn_v", "attn.o": "attn_o",
        "pos_embedding.embedding": "attn_rel_b",
        "norm2": "ffn_norm",
        "ffn.gate.0": "ffn_gate",
        "ffn.fc2": "ffn_down",
        "ffn.fc1": "ffn_up",
    }
    if rest not in table:
        return None
    return f"enc.blk.{int(n)}.{table[rest]}.weight"


def load_vocab(tokdir):
    """Vocab SentencePiece, stessa logica del convertitore ufficiale llama.cpp."""
    import os as _os
    _os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"
    from sentencepiece import SentencePieceProcessor

    sp_path = os.path.join(tokdir, "spiece.model")
    sp = SentencePieceProcessor()
    sp.LoadFromFile(sp_path)
    n_vocab = 256384
    tokens = [f"[PAD{i}]".encode() for i in range(n_vocab)]
    scores = [-10000.0] * n_vocab
    types = [gguf.TokenType.UNUSED] * n_vocab
    for i in range(sp.vocab_size()):
        tokens[i] = sp.IdToPiece(i).encode()
        scores[i] = float(sp.GetScore(i))
        if sp.IsUnknown(i):
            types[i] = gguf.TokenType.UNKNOWN
        elif sp.IsControl(i):
            types[i] = gguf.TokenType.CONTROL
        elif sp.IsUnused(i):
            types[i] = gguf.TokenType.UNUSED
        elif sp.IsByte(i):
            types[i] = gguf.TokenType.BYTE
        else:
            types[i] = gguf.TokenType.NORMAL
    return tokens, scores, types, True, False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--tokdir", required=True)
    ap.add_argument("--dst", required=True)
    args = ap.parse_args()

    sd = torch.load(args.src, map_location="cpu", weights_only=True)
    print(f"tensori in: {len(sd)}", flush=True)

    f16 = gguf.GGMLQuantizationType.F16
    f32 = gguf.GGMLQuantizationType.F32

    w = gguf.GGUFWriter(path=None, arch="t5encoder")
    w.add_architecture()
    w.add_quantization_version(gguf.GGML_QUANT_VERSION)
    w.add_file_type(gguf.LlamaFileType.MOSTLY_F16)
    # umt5-xxl encoder: valori ufficiali
    w.add_context_length(512)
    w.add_embedding_length(4096)
    w.add_feed_forward_length(10240)
    w.add_block_count(24)
    w.add_head_count(64)
    w.add_uint32("t5encoder.attention.head_count_kv", 64)
    w.add_key_length(64)
    w.add_value_length(64)
    w.add_layer_norm_eps(1e-6)
    w.add_layer_norm_rms_eps(1e-6)
    w.add_relative_attn_buckets_count(32)

    n_main = n_keep = n_skip = 0
    for key in sorted(sd.keys()):
        name = map_name(key)
        if name is None:
            print(f"IGNORATO: {key}")
            n_skip += 1
            continue
        t = sd[key].cpu()
        if t.dtype == torch.bfloat16:
            t = t.float()
        arr = np.ascontiguousarray(t.numpy())
        if arr.ndim <= 1 or arr.size <= 1024:
            qtype, out = f32, arr.astype(np.float32)
            n_keep += 1
        else:
            qtype, out = f16, arr.astype(np.float16)
            n_main += 1
        out = np.ascontiguousarray(out)
        w.add_tensor(name, gguf.quants.quantize(out, qtype), raw_dtype=qtype)

    # vocab SentencePiece locale (niente download)
    tokens, scores, types, add_prefix, remove_ws = load_vocab(args.tokdir)
    print(f"vocab: {len(tokens)} pezzi", flush=True)
    # speciali T5: <pad>=0, </s>=1, <unk>=2 (verifica via special_tokens_map sotto)
    try:
        with open(os.path.join(args.tokdir, "special_tokens_map.json"), encoding="utf-8") as f:
            stm = json.load(f)
        print(f"speciali: {stm}", flush=True)
    except Exception as e:
        print(f"special_tokens_map non letto: {e}", flush=True)
    w.add_tokenizer_model("t5")
    w.add_tokenizer_pre("default")
    w.add_token_list(tokens)
    w.add_token_scores(scores)
    w.add_token_types(types)
    w.add_add_space_prefix(add_prefix)
    w.add_remove_extra_whitespaces(remove_ws)
    # T5 non ha BOS: si omette la chiave. EOS=1 (</s>), UNK=2, PAD=0.
    w.add_eos_token_id(1)
    w.add_unk_token_id(2)
    w.add_pad_token_id(0)

    w.write_header_to_file(path=args.dst)
    w.write_kv_data_to_file()
    w.write_tensors_to_file(progress=True)
    w.close()
    print(f"fatto: {args.dst} (f16={n_main} f32={n_keep} ignorati={n_skip})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
