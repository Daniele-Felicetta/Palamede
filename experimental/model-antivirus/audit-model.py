#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""audit-model.py — audit di affidabilità di un file modello con un LLM locale.

GIUDICE: un LLM servito da llama-server su porta 8121 (endpoint OpenAI-compatible,
http://127.0.0.1:8121/v1/chat/completions) funge da giudice di affidabilità. Il
giudice valuta artefatti TESTUALI estratti dal file (mai byte raw) e la sua
provenienza (URL/repo), producendo un verdetto strutturato con rubrica rigida.

QUESTO SCRIPT NON SOSTITUISCE i check deterministici di ``scan-models.py``: li
INTEGRA come triage. scan-models.py verifica integrità/dimensione/formato/hash;
audit-model.py valuta "quanto è sospetto" il contenuto estratto (opcode pickle,
metadata, coerenza, provenienza).

IMPORTANTE — dove NON viene usato l'LLM:
  - ALL'AVVIO dell'app (src-tauri/src/main.rs) NON si chiama mai Ornith/llama-server.
    All'avvio gira SOLO lo scanner deterministico ``scan-models.py --quick``.
  - L'audit LLM avviene SOLO al download (copy-models.ps1) e su richiesta manuale
    (``scan-models.py --llm`` oppure ``audit-model.py`` diretto).

LIMITI CONOSCIUTI:
  - NON rileva backdoor comportamentali nei pesi (es. attivatori latenti): valuta
    solo la struttura, gli opcode, i metadata e la provenienza del file.
  - Il verdetto è un'euristica del giudice locale, non una garanzia.

USO
---
  python model-antivirus/audit-model.py <file>              # audit singolo (LLM + provenienza)
  python model-antivirus/audit-model.py <file> --source <URL>   # con provenienza esplicita
  python model-antivirus/audit-model.py <file> --extract-only  # estrae artefatti, nessun LLM
  python model-antivirus/audit-model.py <file> --json         # report JSON su stdout
  python model-antivirus/audit-model.py --audit-all           # audita i file enforce=true del manifest
  python model-antivirus/audit-model.py --audit-all --out <path># scrive i verdict in <path>

OPZIONI
-------
  --models-dir <path>   Directory dei modelli (i path nel manifest sono RELATIVI a questa).
                         Default: ../../models rispetto al progetto. Usato per risolvere i file
                        da audire e per la relativizzazione degli artefatti.
  --manifest <path>     Path del manifest JSON (default: models.manifest.json accanto allo
                        script). I path dentro il manifest sono RELATIVI alla models-dir.
  --source <URL>        Provenienza (URL di download / repo HF). Usata dal giudice.
  --json                Stampa il report finale in JSON su stdout (per integrazione).
  --extract-only        Estrae gli artefatti e li stampa SENZA chiamare l'LLM (exit 0).
  --audit-all           Audita tutti i file con enforce=true nel manifest, scrive le verdict
                        in un JSON (default model-antivirus/audit-verdicts.json, override con
                        --out) ed calcola l'exit code complessivo.
  --out <path>          Path di output per --audit-all.

CODICI DI USCITA
----------------
  0  affidabile
  1  dubbio (almeno un warning del giudice)
  2  malevolo / almeno un verdetto negativo / errore interno
  3  giudice LLM NON disponibile (verdetto non prodotto; si stampa l'estrazione
     deterministica e un messaggio chiaro).

Per --audit-all l'exit code riflette il file peggiore tra quelli analizzati.

DEPENDENZE: solo libreria standard di Python. Il judge URL/modello sono configurabili
via env: PALAMEDE_JUDGE_URL (default http://127.0.0.1:8121/v1/chat/completions) e
PALAMEDE_JUDGE_MODEL (default ornith-1.5-35b).

LO SCRIPT PUO' ESSER LANCIATO COME COMANDO O IMPORTATO COME MODULO
(importabile via importlib dato il trattino nel nome file).
"""

import argparse
import datetime as _dt
import json
import os
import pickletools
import re
import socket
import struct
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# Windows: la console usa cp1252 e i dump JSON contengono Unicode (es. "▁" dei
# tokenizer sentencepiece) -> forziamo UTF-8 su stdout/stderr per non crashare.
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── percorsi (calcolati da __file__, non dalla cwd) ────────────────────────
PROJECT_DIR = Path(__file__).resolve().parent          # .../model-antivirus
MODELS_DIR = PROJECT_DIR.parent.parent / "models"      # ../../models (di default)
MANIFEST_PATH = PROJECT_DIR / "models.manifest.json"   # model-antivirus/models.manifest.json

# ── estensioni considerate "file modello" (copiate da scan-models.py) ──────
MODEL_EXTS = (".gguf", ".safetensors", ".pt", ".bin", ".pth")
FORMAT_BY_EXT = {
    ".gguf": "gguf",
    ".safetensors": "safetensors",
    ".pt": "pickle",
    ".bin": "pickle",
    ".pth": "pickle",
}

# ── judge (llama-server su porta 8121, endpoint OpenAI-compatible) ─────────
JUDGE_URL_DEFAULT = "http://127.0.0.1:8121/v1/chat/completions"
JUDGE_MODEL_DEFAULT = "ornith-1.5-35b"
JUDGE_TIMEOUT = 180  # secondi

# ── limiti di estrazione (per non esplodere in memoria/tempo) ──────────────
MAX_KV_ENTRIES = 200
MAX_TENSOR_NAMES = 20
MAX_ARRAY_STRINGS = 100
MAX_ARRAY_ITEMS = 5000        # tetto assoluto di elementi per array GGUF
MAX_TENSOR_NDIM = 16          # tetto di dimensioni per un tensor GGUF
MAX_PICKLE_OPS = 100
SAFETENSORS_MAX_TENSORS = 50
PROTO_SCAN_BYTES = 2 << 20          # 2 MiB per lo scan pickle PROTO
CONTEXT_MAX_BYTES = 8 * 1024        # 8 KB per file di contesto

# ── tipi GGUF (GGUF_TYPE_*): copiati dalla spec GGUF ───────────────────────
# 0 uint8, 1 int8, 2 uint16, 3 int16, 4 uint32, 5 int32, 6 float32,
# 7 bool, 8 string, 9 array, 10 uint64, 11 int64, 12 float64

# ── opcode pickle pericolosi (per la raccolta dalla traccia genops) ─────────
PICKLE_DANGEROUS_OPS = {
    "GLOBAL", "REDUCE", "STACK_GLOBAL", "EXT1", "EXT2", "EXT4",
    "NEWOBJ", "INST", "OBJ", "BUILD",
}

# ── pattern ASCII sospetti (fallback se genops non è utilizzabile) ──────────
PICKLE_FALLBACK_PATTERNS = [
    b"os.system", b"subprocess", b"Popen", b"__import__", b"builtins",
    b"eval(", b"exec(", b"socket", b"pty", b"base64", b"marshal", b"REDUCE",
]

# ── file di contesto cercati nella cartella del file ───────────────────────
CONTEXT_FILES = ("config.json", "model_index.json", "README.md", "tokenizer_config.json")

# ── regex per estrarre il primo blocco JSON da una risposta LLM ─────────────
JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


# ════════════════════ ECCEZIONI DI GIUDICATURE ════════════════════════════

class JudgeUnavailable(Exception):
    """Il giudice LLM non è raggiungibile (connessione/timeout/server giù)."""


class JudgeInvalid(Exception):
    """Il giudice ha risposto, ma con qualcosa che non si può parsare/validare."""


# ════════════════════════ UTILITIES DI BASE ═══════════════════════════════

def detect_format(path: Path) -> str:
    """Deduce il formato da estensione; se ignoto prova a leggere i magic bytes."""
    fmt = FORMAT_BY_EXT.get(path.suffix.lower())
    if fmt is not None:
        return fmt
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
    except OSError:
        return "unknown"
    if magic[:4] == b"GGUF":
        return "gguf"
    return "unknown"


def human_size(n):
    """Formatta una dimensione in byte in forma leggibile."""
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} TB"


# ════════════════════════ FASE 1 — ESTRAZIONE ═════════════════════════════

def extract_artifacts(path: Path, source=None) -> dict:
    """Estrae artefatti TESTUALI da un file modello (mai byte raw).

    Restituisce un dict robusto (ogni sottosezione è in try/except, non crasha mai):
      {
        "file": <relativo a models/ o path completo>,
        "format": "gguf|safetensors|pickle|unknown",
        "size_bytes": <int>,
        "source": <provenienza se data>,
        "gguf": {...} | null,
        "safetensors": {...} | null,
        "pickle_trace": [...] | null,
        "context": {filename: "<troncato>"} | {},
      }
    """
    try:
        size = path.stat().st_size
    except OSError as e:
        size = -1

    fmt = detect_format(path)

    # path relativo a models/ se possibile, altrimenti il path completo.
    try:
        rel = path.relative_to(MODELS_DIR).as_posix()
    except ValueError:
        rel = str(path)

    artifacts = {
        "file": rel,
        "format": fmt,
        "size_bytes": size,
        "source": source,
        "gguf": None,
        "safetensors": None,
        "pickle_trace": None,
        "context": {},
    }

    try:
        if fmt == "gguf":
            artifacts["gguf"] = extract_gguf(path)
        elif fmt == "safetensors":
            artifacts["safetensors"] = extract_safetensors(path)
        elif fmt == "pickle":
            artifacts["pickle_trace"] = extract_pickle(path)
    except Exception:
        # mai crashare: una sottosezione fallita non deve bruciare l'estrazione.
        pass

    try:
        artifacts["context"] = extract_context(path)
    except Exception:
        artifacts["context"] = {}

    return artifacts


# ── GGUF ───────────────────────────────────────────────────────────────────
def _read_gguf_value(f, vtype):
    """Legge un valore GGUF di dato tipo ``vtype``. Restituisce una rappresentazione
    testuale (mai raw). Per gli array tronca le stringhe a MAX_ARRAY_STRINGS."""
    try:
        if vtype == 0:   # uint8
            return struct.unpack_from("<B", f.read(1))[0]
        if vtype == 1:   # int8
            return struct.unpack_from("<b", f.read(1))[0]
        if vtype == 2:   # uint16
            return struct.unpack_from("<H", f.read(2))[0]
        if vtype == 3:   # int16
            return struct.unpack_from("<h", f.read(2))[0]
        if vtype == 4:   # uint32
            return struct.unpack_from("<I", f.read(4))[0]
        if vtype == 5:   # int32
            return struct.unpack_from("<i", f.read(4))[0]
        if vtype == 6:   # float32
            return round(struct.unpack_from("<f", f.read(4))[0], 6)
        if vtype == 7:   # bool
            return bool(struct.unpack_from("<B", f.read(1))[0])
        if vtype == 8:   # string
            ln = struct.unpack_from("<Q", f.read(8))[0]
            data = f.read(min(ln, 4096))
            return data.decode("utf-8", "replace")
        if vtype == 9:   # array
            etype = struct.unpack_from("<I", f.read(4))[0]
            count = struct.unpack_from("<Q", f.read(8))[0]
            out = []
            # tetto assoluto: un count enorme (o fuori sync) non deve mandarci
            # in loop infinito. Limitiamo a MAX_ARRAY_ITEMS.
            for _ in range(min(count, MAX_ARRAY_ITEMS)):
                pos_before = f.tell()
                item = _read_gguf_value(f, etype)
                # nessun progresso di lettura (EOF / dato illeggibile) -> stop.
                if f.tell() == pos_before:
                    break
                if isinstance(item, str) and len(out) >= MAX_ARRAY_STRINGS:
                    break
                out.append(item)
            return out
        if vtype == 10:  # uint64
            return struct.unpack_from("<Q", f.read(8))[0]
        if vtype == 11:  # int64
            return struct.unpack_from("<q", f.read(8))[0]
        if vtype == 12:  # float64
            return round(struct.unpack_from("<d", f.read(8))[0], 12)
        # tipo sconosciuto: non leggiamo il dato.
        return "<tipo GGUF sconosciuto>"
    except Exception:
        return "<errore lettura valore>"


def extract_gguf(path: Path) -> dict:
    """Estrae header + metadata (troncati) + primi nomi di tensore di un GGUF."""
    out = {"version": None, "tensor_count": None, "metadata": {}, "first_tensor_names": []}
    try:
        # L'header GGUF è di 24 byte (magic+version+tensor_count+kv_count); i dati
        # dei metadata partono subito dopo, offset 24. Leggo tutto in un solo flusso.
        with open(path, "rb") as f:
            header = f.read(24)
            if len(header) < 24 or header[:4] != b"GGUF":
                out["error"] = "magic bytes GGUF mancanti/non validi (file troncato?)"
                return out
            version = struct.unpack_from("<I", header, 4)[0]
            tensor_count = struct.unpack_from("<Q", header, 8)[0]
            kv_count = struct.unpack_from("<Q", header, 16)[0]
            out["version"] = version
            out["tensor_count"] = tensor_count

            # metadata: fino a MAX_KV_ENTRIES.
            keys_read = 0
            while keys_read < min(kv_count, MAX_KV_ENTRIES):
                try:
                    klen = struct.unpack_from("<Q", f.read(8))[0]
                    key = f.read(min(klen, 4096)).decode("utf-8", "replace")
                    vtype = struct.unpack_from("<I", f.read(4))[0]
                    value = _read_gguf_value(f, vtype)
                except (struct.error, ValueError):
                    break
                out["metadata"][key] = value
                keys_read += 1

            if kv_count > MAX_KV_ENTRIES:
                out["metadata_note"] = f"{int(kv_count) - MAX_KV_ENTRIES} chiavi troncate"

            # primi nomi di tensore.
            for _ in range(MAX_TENSOR_NAMES):
                try:
                    nlen = struct.unpack_from("<Q", f.read(8))[0]
                    name = f.read(min(nlen, 4096)).decode("utf-8", "replace")
                    ndim = struct.unpack_from("<I", f.read(4))[0]
                    # ndim fuori range (o fuori sync) non deve mandarci in loop.
                    if ndim > MAX_TENSOR_NDIM:
                        break
                    shape = []
                    for _ in range(ndim):
                        try:
                            shape.append(struct.unpack_from("<Q", f.read(8))[0])
                        except struct.error:
                            break
                    # type (u32) + offset: non ci servono per il nome, li saltiamo.
                    out["first_tensor_names"].append({"name": name, "shape": shape})
                except (struct.error, ValueError):
                    break
    except OSError as e:
        out["error"] = f"leggibile: {e}"
    return out


# ── safetensors ────────────────────────────────────────────────────────────
def extract_safetensors(path: Path) -> dict:
    """Estrae nomi/shape/dtype dei primi tensori e metadata (__metadata__)."""
    out = {"n_tensors": 0, "tensor_names": [], "metadata": {}}
    try:
        with open(path, "rb") as f:
            hdr8 = f.read(8)
        if len(hdr8) < 8:
            out["error"] = "file più piccolo dell'header (manca la lunghezza header)"
            return out
        header_len = struct.unpack_from("<Q", hdr8, 0)[0]
        if not (0 < header_len < 50_000_000):
            out["error"] = f"header_len {header_len} fuori range plausibile [1, 50MB]"
            return out
        with open(path, "rb") as f:
            f.read(8)
            header_bytes = f.read(header_len)
        if len(header_bytes) < header_len:
            out["error"] = "header safetensors troncato"
            return out
        try:
            header = json.loads(header_bytes)
        except json.JSONDecodeError as e:
            out["error"] = f"header JSON non valido: {e}"
            return out
        if not isinstance(header, dict):
            out["error"] = "header safetensors non è un oggetto JSON"
            return out

        tensors = [(k, v) for k, v in header.items() if k != "__metadata__"]
        out["n_tensors"] = len(tensors)
        for name, meta in tensors[:SAFETENSORS_MAX_TENSORS]:
            if isinstance(meta, dict):
                shape = meta.get("shape")
                dtype = meta.get("dtype")
                out["tensor_names"].append({"name": name, "shape": shape, "dtype": dtype})
        md = header.get("__metadata__")
        if isinstance(md, dict):
            # tronca i valori di metadata per non esplodere.
            for k, v in md.items():
                s = str(v)
                out["metadata"][k] = s[:200]
    except OSError as e:
        out["error"] = f"leggibile: {e}"
    return out


# ── pickle / torch (.pt .bin .pth) ─────────────────────────────────────────
def _collect_pickle_ops(raw: bytes) -> dict:
    """Da un chunk di bytes, usa pickletools.genops per raccogliere SOLO opcode
    non banali con argomenti leggibili. Restituisce {"ops": [...], "truncated": bool}."""
    ops = []
    truncated = False
    try:
        for opcode, arg, pos in pickletools.genops(raw):
            name = opcode.name
            if name not in PICKLE_DANGEROUS_OPS:
                continue
            # GLOBAL / STACK_GLOBAL / EXT*: l'arg è la stringa "module.name".
            if name in ("GLOBAL", "STACK_GLOBAL", "EXT1", "EXT2", "EXT4"):
                label = arg if isinstance(arg, str) else repr(arg)
                ops.append(f"{name} {label}")
            elif name == "REDUCE":
                ops.append("REDUCE")
            elif name in ("NEWOBJ", "INST", "OBJ", "BUILD"):
                ops.append(name)
            else:
                ops.append(name)
            if len(ops) >= MAX_PICKLE_OPS:
                truncated = True
                break
    except Exception:
        # traccia non parseabile: torniamo vuoto (il caller fa il fallback ASCII).
        return {"ops": [], "truncated": False, "parse_error": True}
    return {"ops": ops, "truncated": truncated}


def extract_pickle(path: Path) -> dict:
    """Estrae da un .pt/.bin/.pth una traccia de opcode pericolosi (mai eseguiti).

    - ZIP ("PK"): cerca data.pkl (o il più piccolo .pkl), genops su quel membro.
    - PROTO (primo byte 0x80): genops sui primi 2 MiB.
    - Se nulla: fallback scan ASCII di pattern sospetti.
    """
    result = {"trace": [], "note": "", "fallback_patterns": {}}
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
    except OSError as e:
        result["error"] = f"leggibile: {e}"
        return result

    # .pt moderno == ZIP (torch.save con zip).
    if magic[:2] == b"PK":
        try:
            with zipfile.ZipFile(path) as zf:
                members = [n for n in zf.namelist()
                           if n.endswith((".pkl", ".data.pkl"))]
                target = None
                if "data.pkl" in zf.namelist():
                    target = "data.pkl"
                elif members:
                    # il più piccolo .pkl.
                    try:
                        target = min(members, key=lambda n: zf.getinfo(n).file_size)
                    except Exception:
                        target = members[0]
                if target is None and members:
                    target = members[0]
                if target is None:
                    result["note"] = "archivio ZIP senza membri .pkl/.data.pkl"
                    return result
                try:
                    raw = zf.read(target)
                except Exception as e:
                    result["note"] = f"impossibile leggere {target}: {e}"
                    return result
                collected = _collect_pickle_ops(raw)
                if collected.get("parse_error"):
                    result["trace"] = []
                    result["note"] = "genops non parseabile per data.pkl → fallback ASCII"
                    result.update(_fallback_ascii(path))
                    return result
                result["trace"] = collected["ops"]
                result["note"] = (f"traccia da {target}"
                                  + (" (troncata ai primi 100 opcode)" if collected["truncated"] else ""))
                return result
        except zipfile.BadZipFile:
            result["note"] = "non ZIP valido → fallback ASCII"
            result.update(_fallback_ascii(path))
            return result
        except Exception as e:
            result["note"] = f"errore zip: {e} → fallback ASCII"
            result.update(_fallback_ascii(path))
            return result

    # pickle PROTO classico.
    if not magic or magic[0] != 0x80:
        result["note"] = "primo byte != 0x80 e non ZIP (non è un pickle/torch valido)"
        result.update(_fallback_ascii(path))
        return result

    try:
        with open(path, "rb") as f:
            raw = f.read(PROTO_SCAN_BYTES)
    except OSError as e:
        result["error"] = f"leggibile: {e}"
        return result
    collected = _collect_pickle_ops(raw)
    if collected.get("parse_error"):
        result["trace"] = []
        result["note"] = "genops non parseabile → fallback ASCII"
        result.update(_fallback_ascii(path))
        return result
    result["trace"] = collected["ops"]
    result["note"] = ("traccia troncata ai primi 2MB" +
                      (" (troncata ai primi 100 opcode)" if collected["truncated"] else ""))
    return result


def _fallback_ascii(path: Path) -> dict:
    """Scan streaming di pattern ASCII sospetti nel corpo del file (best-effort)."""
    lowered = [p.lower() for p in PICKLE_FALLBACK_PATTERNS]
    max_len = max((len(p) for p in lowered), default=1)
    overlap = max(1, max_len - 1)
    counts = {}
    carry = b""
    try:
        with open(path, "rb") as f:
            while True:
                block = f.read(1 << 20)
                if not block:
                    break
                window = carry + block
                low = window.lower()
                for pat in lowered:
                    start = 0
                    c = 0
                    while True:
                        idx = low.find(pat, start)
                        if idx == -1:
                            break
                        c += 1
                        start = idx + 1
                    if c:
                        key = pat.decode()
                        counts[key] = counts.get(key, 0) + c
                carry = window[-overlap:] if len(window) >= overlap else window
    except OSError:
        return {"fallback_patterns": {}}
    return {"fallback_patterns": counts}


# ── contesto della cartella ────────────────────────────────────────────────
def _context_dirs(path: Path):
    """Cartelle in cui cercare file di contesto: la cartella del file e, se il
    file è in una sottocartella di models/, anche models/<nome>/."""
    dirs = [path.parent]
    try:
        rel = path.relative_to(MODELS_DIR)
        if len(rel.parts) >= 2:  # c'è almeno un subdir sotto models/
            dirs.append(MODELS_DIR / rel.parts[0])
    except ValueError:
        pass
    return dirs


def extract_context(path: Path) -> dict:
    """Legge (max 8 KB ciascuno) config.json, model_index.json, README.md,
    tokenizer_config.json presenti nelle cartelle del file."""
    out = {}
    seen_dirs = []
    for d in _context_dirs(path):
        if d not in seen_dirs:
            seen_dirs.append(d)
    for d in seen_dirs:
        for fname in CONTEXT_FILES:
            fpath = d / fname
            try:
                if not fpath.is_file():
                    continue
                with open(fpath, "rb") as f:
                    raw = f.read(CONTEXT_MAX_BYTES)
                text = raw.decode("utf-8", "replace")
                if len(raw) >= CONTEXT_MAX_BYTES:
                    text += "\n...[troncato a 8 KB]..."
                out[fname] = text
            except OSError:
                continue
    return out


# ════════════════════════ FASE 2 — GIUDICE LLM ═════════════════════════════

SYSTEM_PROMPT = (
    "Sei un auditor di sicurezza di modelli de machine learning. Valuti artefatti "
    "estratti da un file di modello e la sua provenienza. Regole rigide:\n"
    "(1) basi ogni affermazione su prove concrete negli artefatti, citando il dato specifico;\n"
    "(2) NON inventare sospetti: senza evidenza punteggio alto (affidabile);\n"
    "(3) NON usi preconcetti sul modello: giudichi il file e la fonte, non il nome;\n"
    "(4) se un artefatto è assente, segna 'non disponibile' senza penalizzare."
)

USER_PROMPT_TEMPLATE = (
    "Artefatti estratti dal file:\n"
    "{artifacts_text}\n\n"
    "Provenienza: {source}\n\n"
    "Valuta l'affidabilità di questo file modello. Rispondi SOLO con un oggetto JSON "
    "valido con questo schema esatto:\n"
    "{{\"verdict\": \"affidabile\"|\"dubbio\"|\"malevolo\", "
    "\"overall_score\": 0-10, "
    "\"scores\": {{\"struttura_file\": 0-10, \"opcode_pickle\": 0-10, "
    "\"metadata\": 0-10, \"coerenza\": 0-10, \"provenienza\": 0-10}}, "
    "\"red_flags\": [stringhe], \"motivazione\": stringa}}. "
    "overall_score 10 = affidabile, 0 = malevolo. red_flags vuoto se nessuna bandiera."
)


def artifacts_to_text(artifacts: dict) -> str:
    """Converte l'artifacts dict in una descrizione testuale pulita per il judge."""
    lines = []
    lines.append(f"Formato: {artifacts.get('format')}")
    size = artifacts.get("size_bytes", -1)
    lines.append(f"Dimensione: {human_size(size) if size and size > 0 else 'sconosciuta'}")
    src = artifacts.get("source")
    lines.append(f"Provenienza (field): {src if src else 'non indicata'}")

    gguf = artifacts.get("gguf")
    if isinstance(gguf, dict):
        lines.append("\n[GGUF]")
        if gguf.get("error"):
            lines.append(f"  errore estrazione: {gguf['error']}")
        else:
            lines.append(f"  versione GGUF: {gguf.get('version')}")
            lines.append(f"  tensor_count: {gguf.get('tensor_count')}")
            md = gguf.get("metadata", {})
            if md:
                lines.append(f"  metadata ({len(md)} voci, prime):")
                for k, v in list(md.items())[:40]:
                    lines.append(f"    - {k}: {v!r}")
            else:
                lines.append("  metadata: vuote/non disponibili")
            names = gguf.get("first_tensor_names", [])
            if names:
                lines.append(f"  primi tensori ({len(names)}):")
                for t in names[:20]:
                    lines.append(f"    - {t.get('name')} shape={t.get('shape')}")
            else:
                lines.append("  nomi tensore: non disponibili")

    st = artifacts.get("safetensors")
    if isinstance(st, dict):
        lines.append("\n[SAFETENSORS]")
        if st.get("error"):
            lines.append(f"  errore estrazione: {st['error']}")
        else:
            lines.append(f"  n_tensors: {st.get('n_tensors')}")
            tn = st.get("tensor_names", [])
            if tn:
                lines.append(f"  primi tensori ({len(tn)}):")
                for t in tn[:50]:
                    lines.append(f"    - {t.get('name')} shape={t.get('shape')} dtype={t.get('dtype')}")
            else:
                lines.append("  nomi tensori: non disponibili")
            md = st.get("metadata", {})
            if md:
                lines.append(f"  __metadata__ ({len(md)} voci):")
                for k, v in list(md.items())[:40]:
                    lines.append(f"    - {k}: {v}")
            else:
                lines.append("  __metadata__: assente/non disponibile")

    pk = artifacts.get("pickle_trace")
    if isinstance(pk, dict):
        lines.append("\n[PICKLE]")
        if pk.get("error"):
            lines.append(f"  errore estrazione: {pk['error']}")
        else:
            trace = pk.get("trace", [])
            if trace:
                lines.append(f"  opcode pericolosi rilevati ({len(trace)}):")
                for op in trace[:100]:
                    lines.append(f"    - {op}")
            else:
                lines.append("  opcode pericolosi: nessuno rilevato")
            fp = pk.get("fallback_patterns", {})
            if fp:
                occ = ", ".join(f"{k}={v}" for k, v in sorted(fp.items()))
                lines.append(f"  pattern ASCII sospetti (fallback): {occ}")
            if pk.get("note"):
                lines.append(f"  nota: {pk['note']}")

    ctx = artifacts.get("context", {})
    if ctx:
        lines.append("\n[CONTESTO CARTELLA]")
        for fname, text in ctx.items():
            snippet = text.replace("\n", " ")[:300]
            lines.append(f"  {fname}: {snippet}")

    return "\n".join(lines)


def build_request_body(artifacts: dict, judge_url: str, judge_model: str,
                       use_response_format: bool):
    """Costruisce il body della richiesta al giudice (schema OpenAI-compatible)."""
    user_text = USER_PROMPT_TEMPLATE.format(
        artifacts_text=artifacts_to_text(artifacts),
        source=artifacts.get("source") or "non indicata",
    )
    body = {
        "model": judge_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.0,
        "max_tokens": 1024,
    }
    if use_response_format:
        body["response_format"] = {"type": "json_object"}
    return body


def call_judge(artifacts: dict, judge_url=None, judge_model=None) -> dict:
    """Chiama il giudice LLM e restituisce il verdetto parsato.

    Lancia JudgeUnavailable se il server non è raggiungibile, JudgeInvalid se la
    risposta non è parseabile/valida.
    """
    url = judge_url or os.environ.get("PALAMEDE_JUDGE_URL") or JUDGE_URL_DEFAULT
    model = judge_model or os.environ.get("PALAMEDE_JUDGE_MODEL") or JUDGE_MODEL_DEFAULT

    body = build_request_body(artifacts, url, model, use_response_format=True)
    payload = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    last_err = None
    for attempt in range(2):  # primo con response_format, secondo senza (fallback 400)
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=JUDGE_TIMEOUT) as resp:
                raw = resp.read()
            text = raw.decode("utf-8", "replace").strip()
            verdict = parse_verdict(text)
            if verdict is not None:
                verdict.setdefault("judge_model", model)
                return verdict
            # risposta valida come HTTP ma non parseabile come JSON → riprova senza RF.
            last_err = "risposta non JSON"
        except urllib.error.HTTPError as e:
            if e.code == 400 and attempt == 0:
                # il server non supporta response_format: riprova senza.
                body = build_request_body(artifacts, url, model, use_response_format=False)
                payload = json.dumps(body).encode("utf-8")
                last_err = f"HTTP 400 (response_format non supportato), riprovo senza"
                continue
            last_err = f"HTTP {e.code}: {e.reason}"
        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            raise JudgeUnavailable(str(e))
        except Exception as e:  # network/connessione in generale
            raise JudgeUnavailable(str(e))

    # Se siamo qui: nessuna risposta valida. Fallback per parole chiave.
    fallback = keyword_fallback(last_err)
    if fallback is not None:
        fallback.setdefault("judge_model", model)
        return fallback
    raise JudgeInvalid(f"risposta giudice non valida ({last_err})")


def parse_verdict(text: str):
    """Estrai il primo blocco JSON da ``text`` e validalo. Restituisce dict o None."""
    if not text:
        return None
    m = JSON_BLOCK_RE.search(text)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    # campi essenziali.
    verdict = obj.get("verdict")
    overall = obj.get("overall_score")
    if verdict not in ("affidabile", "dubbio", "malevolo"):
        return None
    if not isinstance(overall, (int, float)):
        return None
    # normalizza i scores.
    scores = obj.get("scores")
    if not isinstance(scores, dict):
        scores = {}
    for key in ("struttura_file", "opcode_pickle", "metadata", "coerenza", "provenienza"):
        v = scores.get(key)
        if not isinstance(v, (int, float)):
            scores[key] = None
    obj["scores"] = scores
    flags = obj.get("red_flags")
    if not isinstance(flags, list):
        obj["red_flags"] = []
    if not isinstance(obj.get("motivazione"), str):
        obj["motivazione"] = ""
    return obj


def keyword_fallback(text: str):
    """Fallback: se il giudice ha risposto ma non in JSON, cerco parole chiave."""
    low = (text or "").lower()
    for kw, verdict in (("malevolo", "malevolo"), ("malicious", "malevolo"),
                        ("dubbio", "dubbio"), ("sospett", "dubbio"),
                        ("affidabile", "affidabile"), ("reliable", "affidabile")):
        if kw in low:
            return {
                "verdict": verdict,
                "overall_score": {"malevolo": 1, "dubbio": 5, "affidabile": 9}[verdict],
                "scores": {k: None for k in
                           ("struttura_file", "opcode_pickle", "metadata", "coerenza", "provenienza")},
                "red_flags": [],
                "motivazione": f"verdetto dedotto per parole chiave dal testo del giudice",
            }
    return None


# ════════════════════════ FASE 3 — REPORT ═════════════════════════════════

def exit_code_for_verdict(verdict: str) -> int:
    """verdetto → exit code (singolo file)."""
    return {"affidabile": 0, "dubbio": 1, "malevolo": 2}.get(verdict, 2)


def report(artifacts: dict, verdict_dict: dict) -> dict:
    """Costruisce il report finale (usato sia per singolo file che per audit-all)."""
    return {
        "file": artifacts.get("file"),
        "format": artifacts.get("format"),
        "size_bytes": artifacts.get("size_bytes"),
        "source": artifacts.get("source"),
        "verdict": verdict_dict.get("verdict"),
        "overall_score": verdict_dict.get("overall_score"),
        "scores": verdict_dict.get("scores", {}),
        "red_flags": verdict_dict.get("red_flags", []),
        "motivazione": verdict_dict.get("motivazione", ""),
        "judge_model": verdict_dict.get("judge_model"),
        "data": _dt.datetime.now().astimezone().isoformat(),
    }


def print_report(report_dict: dict):
    """Stampa un report leggibile in italiano."""
    bar = "=" * 72
    sub = "-" * 72
    print(bar)
    print("  AUDIT AFFIDABILITÀ MODELLO — Palamede (giudice LLM locale)")
    print(bar)
    print(f"  File      : {report_dict.get('file')}")
    print(f"  Formatto  : {report_dict.get('format')}")
    size = report_dict.get("size_bytes")
    print(f"  Dimensione: {human_size(size) if size and size > 0 else 'sconosciuta'}")
    print(f"  Provenienza: {report_dict.get('source') or 'non indicata'}")
    verdict = report_dict.get("verdict")
    score = report_dict.get("overall_score")
    flag = {"affidabile": "✅ AFFIDABILE", "dubbio": "⚠️  DUBBIO", "malevolo": "🛑 MALEVOLO"}.get(
        verdict, f"? {verdict}")
    print(f"  Verdetto  : {flag}   (punteggio {score}/10)")
    scores = report_dict.get("scores") or {}
    if scores:
        print(sub)
        print("  Punteggi per dimensione:")
        for k, v in scores.items():
            disp = f"{v}/10" if isinstance(v, (int, float)) else "n.d."
            print(f"    - {k}: {disp}")
    flags = report_dict.get("red_flags") or []
    if flags:
        print(sub)
        print("  Bandieri rossi:")
        for f in flags:
            print(f"    • {f}")
    motiv = report_dict.get("motivazione")
    if motiv:
        print(sub)
        print(f"  Motivazione:\n    {motiv}")
    jm = report_dict.get("judge_model")
    if jm:
        print(sub)
        print(f"  Giudice   : {jm}")
    print(bar)


# ════════════════════════ ARTIFATTI come OUTPUT (extract-only) ═════════════

def dump_artifacts(artifacts: dict):
    """Stampa gli artefatti estratti (JSON) — usato da --extract-only."""
    print(json.dumps(artifacts, indent=2, ensure_ascii=False))


# ════════════════════════ SINGLE FILE ═════════════════════════════════════

def run_single(path: Path, source=None, as_json=False, extract_only=False) -> int:
    """Gestisce l'audit di un singolo file. Restituisce l'exit code."""
    if not path.exists():
        print(f"[audit] file non trovato: {path}", file=sys.stderr)
        return 2

    artifacts = extract_artifacts(path, source=source)

    if extract_only:
        dump_artifacts(artifacts)
        print("\n[audit] --extract-only: estrazione completata, nessun LLM invocato.",
              file=sys.stderr)
        return 0

    try:
        verdict = call_judge(artifacts)
    except JudgeUnavailable as e:
        # Giudice non disponibile: stampo l'estrazione deterministica + messaggio.
        print("[audit] giudice LLM NON disponibile (connessione/timeout/server giù).",
              file=sys.stderr)
        print(f"[audit] dettaglio: {e}", file=sys.stderr)
        print("\n[audit] estrazione deterministica degli artefatti:", file=sys.stderr)
        dump_artifacts(artifacts)
        return 3
    except JudgeInvalid as e:
        print(f"[audit] {e}", file=sys.stderr)
        dump_artifacts(artifacts)
        return 3
    except Exception as e:  # errore interno imprevisto
        print(f"[audit] errore interno: {e}", file=sys.stderr)
        return 2

    rep = report(artifacts, verdict)
    if as_json:
        print(json.dumps(rep, indent=2, ensure_ascii=False))
    else:
        print_report(rep)
    return exit_code_for_verdict(verdict.get("verdict", "malevolo"))


# ════════════════════════ AUDIT ALL ═══════════════════════════════════════

def _load_manifest():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def run_audit_all(out_path=None):
    """Audita tutti i file con enforce=true del manifest. Restituisce l'exit code.

    I path nel manifest sono RELATIVI alla models-dir (MODELS_DIR).
    """
    try:
        manifest = _load_manifest()
    except FileNotFoundError:
        print(f"[audit] manifest non trovato in {MANIFEST_PATH}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as e:
        print(f"[audit] manifest non valido JSON ({MANIFEST_PATH}): {e}", file=sys.stderr)
        return 2

    entries = [e for e in manifest.get("files", []) if e.get("enforce") and e.get("path")]
    if not entries:
        print("[audit] nessuna entry enforce=true nel manifest; nulla da audire.",
              file=sys.stderr)
        return 0

    judge_url = os.environ.get("PALAMEDE_JUDGE_URL") or JUDGE_URL_DEFAULT
    judge_model = os.environ.get("PALAMEDE_JUDGE_MODEL") or JUDGE_MODEL_DEFAULT

    results = []
    worst = 0          # peggior exit code tra i file
    judge_unavailable_all = False

    for idx, entry in enumerate(entries):
        rel = entry["path"]
        path = MODELS_DIR / rel
        source = entry.get("source") or entry.get("format")

        try:
            artifacts = extract_artifacts(path, source=source)
            verdict = call_judge(artifacts, judge_url, judge_model)
        except JudgeUnavailable as e:
            # Giudice non raggiungibile: segnalo judge_unavailable per questo file
            # E per tutti i restanti (la connessione è globale).
            print(f"[audit] giudice LLM non disponibile ({e})", file=sys.stderr)
            judge_unavailable_all = True
            for remaining in entries[idx:]:
                results.append({
                    "file": remaining.get("path"),
                    "format": None,
                    "size_bytes": None,
                    "source": remaining.get("source"),
                    "verdict": None,
                    "status": "judge_unavailable",
                    "overall_score": None,
                    "scores": {},
                    "red_flags": [],
                    "motivazione": f"giudice LLM non disponibile: {e}",
                    "judge_model": judge_model,
                })
            worst = max(worst, 3)
            break
        except Exception as e:
            # Eccezione diversa da JudgeUnavailable: il file fallisce → malevolo.
            print(f"[audit] {rel}: errore durante l'audit ({e})", file=sys.stderr)
            results.append({
                "file": rel,
                "format": artifacts.get("format") if 'artifacts' in dir() else None,
                "size_bytes": artifacts.get("size_bytes") if 'artifacts' in dir() else None,
                "source": source,
                "verdict": "malevolo",
                "status": "error",
                "overall_score": 0,
                "scores": {},
                "red_flags": ["errore durante l'audit: " + str(e)],
                "motivazione": f"errore interno: {e}",
                "judge_model": judge_model,
            })
            worst = max(worst, 2)
            continue

        rep = report(artifacts, verdict)
        results.append(rep)
        code = exit_code_for_verdict(verdict.get("verdict", "malevolo"))
        worst = max(worst, code)

    # scrivo il file di verdict.
    out = Path(out_path) if out_path else PROJECT_DIR / "audit-verdicts.json"
    report_obj = {
        "generated": _dt.datetime.now().astimezone().isoformat(),
        "judge_url": judge_url,
        "judge_model": judge_model,
        "n_files": len(results),
        "worst_exit_code": worst,
        "files": results,
    }
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(report_obj, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"[audit] verdict scritti in {out}")
    except OSError as e:
        print(f"[audit] impossibile scrivere {out}: {e}", file=sys.stderr)

    # riepilogo.
    counts = {}
    for r in results:
        v = r.get("verdict") or r.get("status")
        counts[v] = counts.get(v, 0) + 1
    print("-" * 72)
    print(f"  Riepilogo audit-all ({len(results)} file enforce=true): "
          f"{counts}")
    if judge_unavailable_all:
        print("  [audit] giudice LLM non disponibile (verifiche deterministiche "
              "comunque fatte da scan-models.py).")
    print(f"  Peggior exit code: {worst}")
    print("=" * 72)

    return worst


# ════════════════════════ MAIN ════════════════════════════════════════════

def main(argv=None):
    global MODELS_DIR, MANIFEST_PATH

    parser = argparse.ArgumentParser(
        prog="audit-model.py",
        description="Audit di affidabilità di un file modello con un LLM locale "
                    "(giudice su llama-server :8121). Integra — non sostituisce — "
                    "scan-models.py.")
    parser.add_argument("file", nargs="?", help="File modello da auditare (.gguf/.safetensors/.pt).")
    parser.add_argument("--source", help="Provenienza (URL di download / repo HF).")
    parser.add_argument("--json", action="store_true", help="Output JSON su stdout.")
    parser.add_argument("--extract-only", action="store_true",
                        help="Estrae gli artefatti senza chiamare l'LLM (exit 0).")
    parser.add_argument("--audit-all", action="store_true",
                        help="Audita tutti i file enforce=true del manifest.")
    parser.add_argument("--out", help="Path di output per --audit-all "
                                      "(default model-antivirus/audit-verdicts.json).")
    parser.add_argument("--models-dir", default=None,
                         help="Directory dei modelli (path nel manifest RELATIVI a questa) "
                              "(default: ../../models rispetto al progetto).")
    parser.add_argument("--manifest", default=None,
                        help="Path del manifest JSON (default: models.manifest.json accanto).")
    args = parser.parse_args(argv)

    if args.models_dir:
        MODELS_DIR = Path(args.models_dir).resolve()
    if args.manifest:
        MANIFEST_PATH = Path(args.manifest).resolve()

    if args.audit_all:
        return run_audit_all(out_path=args.out)

    if not args.file:
        parser.error("manca il file da auditare (o usa --audit-all)")

    path = Path(args.file)
    if not path.is_absolute():
        path = Path.cwd() / path

    return run_single(path, source=args.source, as_json=args.json,
                      extract_only=args.extract_only)


if __name__ == "__main__":
    sys.exit(main())
