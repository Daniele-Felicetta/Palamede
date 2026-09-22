"""Palamede — ripara le forme GGUF dopo llama-quantize (own code).

llama-quantize (C++) elimina le dimensioni singleton (es. [1,6,1536]
memorizzato come (1536,6)): i byte restano in C-order dell'originale, quindi
basta riscrivere il tensore con le dims memorizzate corrette. Le forme
originali vengono lette da --ref (safetensors/.pth con gli stessi nomi).

Uso:
  python scripts/gguf_fix_shapes.py --src in.gguf --ref orig.safetensors --dst out.gguf
"""
import argparse
import sys

import gguf
import numpy as np
import torch
from safetensors.torch import load_file


def load_shapes(path):
    if path.endswith((".pt", ".pth", ".bin", ".ckpt")):
        sd = torch.load(path, map_location="cpu", weights_only=True)
    else:
        sd = load_file(path)
    shapes = {}
    for k, v in sd.items():
        s = tuple(v.shape) if isinstance(v, torch.Tensor) else tuple(v.shape)
        shapes[k] = tuple(int(x) for x in s)
    return shapes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--dst", required=True)
    args = ap.parse_args()

    ref = load_shapes(args.ref)
    reader = gguf.GGUFReader(args.src)
    arch = str(reader.get_field("general.architecture").parts[-1], encoding="utf-8")
    ftype = int(reader.get_field("general.file_type").parts[-1])

    writer = gguf.GGUFWriter(path=None, arch=arch)
    writer.add_quantization_version(gguf.GGML_QUANT_VERSION)
    writer.add_file_type(gguf.LlamaFileType(ftype))
    skip = {"general.architecture", "general.quantization_version", "general.file_type",
            "GGUF.version", "GGUF.tensor_count", "GGUF.kv_count"}
    for f in reader.fields.values():
        if f.name in skip or f.name.endswith("quantize.imatrix"):
            continue
        writer.add_key_value(f.name, f.types[0], f.data if len(f.data) > 1 else f.data[0])

    fixed = 0
    plain = {gguf.GGMLQuantizationType.F32, gguf.GGMLQuantizationType.F16,
             gguf.GGMLQuantizationType.BF16}
    for t in reader.tensors:
        data = t.data
        if t.name in ref:
            want_stored = tuple(reversed(ref[t.name]))
            got_stored = tuple(int(x) for x in t.shape)
            if want_stored != got_stored:
                if int(np.prod(want_stored)) != int(np.prod(got_stored)):
                    raise RuntimeError(f"numel diverso per {t.name}: {want_stored} vs {got_stored}")
                if t.tensor_type not in plain:
                    raise RuntimeError(f"refuso forma su tensore quantizzato {t.name}: stop")
                # stessi byte (C-order): si riscrive con la forma originale,
                # il writer inverte le dims da solo come al solito
                arr = np.ascontiguousarray(data).reshape(ref[t.name])
                writer.add_tensor(t.name, arr, raw_dtype=t.tensor_type)
                fixed += 1
                continue
        writer.add_tensor(t.name, data, raw_dtype=t.tensor_type)

    writer.write_header_to_file(path=args.dst)
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file(progress=True)
    writer.close()
    print(f"fatti: {fixed} forme riparate -> {args.dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
