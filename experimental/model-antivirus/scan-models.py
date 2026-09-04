#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""scan-models.py — verifica di integrità dei modelli in models/.

Scanner standalone (solo libreria standard) che controlla l'integrità dei
modelli elencati nel manifest del progetto ``model-antivirus`` e segnala eventuali
anomalie prima dell'avvio dell'app.

Il manifest contiene path RELATIVI alla models-dir (es. ``flux-2-klein-4b-Q4_K_M.gguf``,
NON ``models/...``). La models-dir di default è ``../../models rispetto al progetto``;
può essere sovrascissa con ``--models-dir`` e il manifest con ``--manifest``.

USO
---
  python model-antivirus/scan-models.py              # scan completo (es.+dim+SHA-256+formato)
  python model-antivirus/scan-models.py --quick      # salta lo SHA-256 (es.+dim+formato)
  python model-antivirus/scan-models.py --update     # rigenera il manifest con gli hash attuali
  python model-antivirus/scan-models.py --llm        # alla fine, audita anche con l'LLM

OPZIONI
-------
  --models-dir <path>   Directory dei modelli da scandire (default: ../../models rispetto
                        a questo progetto). I path nel manifest sono RELATIVI a questa
                        cartella.
  --manifest <path>     Path del manifest JSON (default: models.manifest.json qui accanto).
  --update              Rigenera il manifest calcolando lo SHA-256 di tutti i file modello
                        presenti nella models-dir. Preserva, per le entry già esistenti
                        (match per path), i campi source/enforce/format; le nuove entry
                        hanno enforce=false, source="auto" e formato dedotto dall'estensione.
                        Aggiorna il campo "generated" alla data odierna. NON eseguirlo se
                        non si è sicuro che i file su disco siano attendibili.
  --quick               Non calcola lo SHA-256 (utile sui modelli di decine di GB). Fa solo
                        esistenza, dimensione e validazione del formato.
  --llm                 Alla fine dello scan deterministico esegue l'audit di affidabilità
                        con l'LLM locale (``audit-model.py --audit-all --json``). Si usa
                        SOLO al download o su richiesta manuale: MAI all'avvio dell'app.

COMPORTAMENTO
-------------
Per ogni entry nel manifest vengono verificate: esistenza, dimensione esatta,
SHA-256 esatto (se non in modalita' quick) e validità del formato:
  - gguf        : magic "GGUF", versione u32 LE in [1,3], tensor_count u64 LE > 0.
  - safetensors : header JSON valido, offset dei tensori dentro i limiti del file.
  - pickle (.pt): primo byte == 0x80 + scan streaming di pattern ASCII sospetti
                  (os.system, subprocess, __import__, REDUCE, ...) -> SOSPETTO.

File modello presenti su disco ma NON nel manifest vengono segnalati come
"non registrati" (possibile intruso).

CODICI DI USCITA
----------------
  0  tutto ok
  1  almeno un warning / sospetto
  2  almeno un errore grave
     (un errore grave si ha quando una violazione riguarda un file con
     enforce=true; con enforce=false la stessa violazione è un warning).

LO SCRIPT PUO' ESSER LANCIATO COME COMANDO O IMPORTATO COME MODULO
(importabile via importlib dato il trattino nel nome file).
"""

import argparse
import hashlib
import io
import json
import struct
import subprocess
import sys
import zipfile
from datetime import date
from pathlib import Path

# ── percorsi (calcolati da __file__, non dalla cwd) ────────────────────────
PROJECT_DIR = Path(__file__).resolve().parent          # .../model-antivirus
MODELS_DIR = PROJECT_DIR.parent.parent / "models"      # ../../models (di default)
MANIFEST_PATH = PROJECT_DIR / "models.manifest.json"   # model-antivirus/models.manifest.json

# ── estensioni considerate "file modello" ─────────────────────────────────
MODEL_EXTS = (".gguf", ".safetensors", ".pt", ".bin", ".pth")
FORMAT_BY_EXT = {
    ".gguf": "gguf",
    ".safetensors": "safetensors",
    ".pt": "pickle",
    ".bin": "pickle",
    ".pth": "pickle",
}

BLOCK_SIZE = 1 << 20  # 1 MiB per lettura/streaming

# ── pattern ASCII sospetti per lo scan di pickle/torch.load (case-insens.) ──
PICKLE_PATTERNS = [
    b"os.system", b"subprocess", b"Popen", b"__import__", b"builtins",
    b"eval(", b"exec(", b"system(", b"socket", b"pty", b"popen",
    b"base64", b"pickle", b"marshal", b"REDUCE",
]

# ── status del report ──────────────────────────────────────────────────────
STATUS_OK = "OK"
STATUS_ERR = "ERRORE"
STATUS_WARN = "WARNING"
STATUS_SUSP = "SOSPETTO"

DEFAULT_NOTE = (
    "Integrita' dei modelli in models/. Gli SHA-256 sono stati calcolati dai "
    "file attualmente presenti (trust-on-first-use). Se aggiorni un modello, "
    "rigenera con: python scan-models.py --update. "
    "enforce=true = file usato a runtime (verifica rapida all'avvio); "
    "enforce=false = presente ma non referenziato dai server (solo segnalazione)."
)


# ════════════════════════════ UTILITIES ═══════════════════════════════

def sha256_of(path):
    """Calcola lo SHA-256 di un file leggendolo a blocchi. Restituisce None in
    caso di errore I/O."""
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(BLOCK_SIZE)
                if not chunk:
                    break
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def load_manifest():
    """Carica il manifest (path da MANIFEST_PATH). Se assente restituisce
    {"files": []}; se presente ma non valido lancia json.JSONDecodeError."""
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ════════════════════ VALIDAZIONE PER FORMATO ═════════════════════════

def validate_gguf(path, size):
    """Restituisce una lista di messaggi di problema (vuota se ok)."""
    try:
        with open(path, "rb") as f:
            header = f.read(16)
    except OSError as e:
        return [f"leggibile: {e}"]
    if len(header) < 16 or header[:4] != b"GGUF":
        return ["magic bytes non validi (atteso b'GGUF': file troncato o formato sconosciuto)"]
    version = struct.unpack_from("<I", header, 4)[0]
    tensor_count = struct.unpack_from("<Q", header, 8)[0]
    issues = []
    if not (1 <= version <= 3):
        issues.append(f"versione GGUF {version} fuori range [1,3]")
    if not (0 < tensor_count < 1_000_000):
        issues.append(f"tensor_count {tensor_count} non plausibile (>0 e <1.000.000)")
    if size < 1024:
        issues.append("file troppo piccolo (<1 KiB) per un GGUF valido")
    return issues


def validate_safetensors(path, size):
    """Restituisce una lista di messaggi di problema (vuota se ok)."""
    try:
        with open(path, "rb") as f:
            hdr8 = f.read(8)
            if len(hdr8) < 8:
                return ["file più piccolo dell'header (manca la lunghezza header)"]
            header_len = struct.unpack_from("<Q", hdr8, 0)[0]
            if not (0 < header_len < 50_000_000):
                return [f"header_len {header_len} fuori range [1, 50MB]"]
            header_bytes = f.read(header_len)
            if len(header_bytes) < header_len:
                return ["header safetensors troncato"]
    except OSError as e:
        return [f"leggibile: {e}"]
    try:
        header = json.loads(header_bytes)
    except json.JSONDecodeError as e:
        return [f"header JSON non valido: {e}"]
    if not isinstance(header, dict):
        return ["header safetensors non è un oggetto JSON"]

    issues = []
    for name, meta in header.items():
        if name == "__metadata__":
            continue
        if not isinstance(meta, dict):
            issues.append(f"{name}: metadati tensore non oggetto")
            continue
        off = meta.get("data_offsets")
        if not (isinstance(off, list) and len(off) == 2):
            issues.append(f"{name}: data_offsets mancanti/non validi")
            continue
        b, e = off[0], off[1]
        if not (isinstance(b, int) and isinstance(e, int)):
            issues.append(f"{name}: offset non interi")
            continue
        if b < 0:
            issues.append(f"{name}: data_offsets[0] ({b}) < 0")
        if e > size:
            issues.append(
                f"{name}: data_offsets[1] ({e}) oltre la dimensione del file ({size})"
            )
        if b > e:
            # begin > end = corruzione reale. begin == end è un tensore zero-size
            # (valido, es. tensori di shape vuota nel safetensors reale).
            issues.append(f"{name}: offset non validi (begin {b} > end {e})")
    return issues


def scan_pickle_suspicious(path):
    """Scan streaming (blocchi di 1 MiB) alla ricerca di pattern ASCII sospetti
    nel corpo di un pickle/torch.load.

    Restituisce un dict {pattern: occorrenze}. I conteggi sono approssimati a
    causa dei bordi tra un blocco e l'altro (overlap di ``max_len-1`` byte): va
    bene come euristica di segnalazione, non como controllo esatto.
    """
    lowered = [p.lower() for p in PICKLE_PATTERNS]
    max_len = max((len(p) for p in lowered), default=1)
    overlap = max(1, max_len - 1)
    counts = {}
    carry = b""
    try:
        with open(path, "rb") as f:
            while True:
                block = f.read(BLOCK_SIZE)
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
        return {}
    return counts


def validate_pickle(path, size):
    """Valida un file pickle/torch (.pt/.bin/.pth).

    I file .pt moderni (PyTorch >= 1.6) sono archivi ZIP validi (magic "PK\\x03\\x04"),
    non pickle PROTO. Riconosciamo entrambi i formati:

      - ZIP valido -> OK; scano i NOMI dei file interni per pattern sospetti
        (leggero, evita di decomprimere gigabyte).
      - PROTO (primo byte 0x80) -> scan streaming del contenuto.

    Restituisce una tupla (verdetto, dato):
      ("ok", None)                       -> file pulito
      ("suspicious", {pattern: n})       -> pattern trovati (warning SOSPETTO)
      ("error", "motivo")                -> formato non riconosciuto / I/O fallito
    """
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
    except OSError as e:
        return ("error", f"leggibile: {e}")

    # .pt moderno == archivi ZIP (torch.save con zip)
    if magic[:2] == b"PK":
        counts = scan_zip_suspicious(path)
        if counts:
            return ("suspicious", counts)
        return ("ok", None)

    # pickle PROTO classico
    if not magic or magic[0] != 0x80:
        return ("error", "primo byte != 0x80 e non ZIP (non è un pickle/torch valido)")

    counts = scan_pickle_suspicious(path)
    if counts:
        return ("suspicious", counts)
    return ("ok", None)


def scan_zip_suspicious(path):
    """Scano i NOMI dei file all'interno di un .pt (zip) per pattern sospetti.

    Leggere e decomprimere gigabyte sarebbe troppo lento; i nomi degli archivi
    torch non contengono tipicamente codice, ma il controllo sui nomi è una
    prima rete di sicurezza economica. Restituisce {pattern: occorrenze}.
    """
    lowered = [p.lower() for p in PICKLE_PATTERNS]
    counts = {}
    try:
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                name = info.filename.lower().encode("utf-8", "ignore")
                for pat in lowered:
                    if pat in name:
                        counts[pat.decode()] = counts.get(pat.decode(), 0) + 1
    except (zipfile.BadZipFile, OSError):
        return {}
    return counts


# ════════════════════ VALIDAZIONE DI UNA ENTRY ════════════════════════

def validate_entry(entry, quick=False):
    """Valida una singola entry del manifest.

    Restituisce una lista di (status, messaggio). Lista vuota => file OK.
    La severità della violazione dipende dal flag ``enforce`` dell'entry:
      enforce=true  -> ERRORE (exit 2)
      enforce=false -> WARNING (exit 1)
    Il path dell'entry è RELATIVO alla models-dir (MODELS_DIR).
    """
    rel = entry.get("path", "<senza path>")
    path = MODELS_DIR / rel
    enforce = bool(entry.get("enforce"))
    sev = STATUS_ERR if enforce else STATUS_WARN

    if not path.exists():
        return [(sev, f"{rel}: file assente su disco")]
    try:
        size = path.stat().st_size
    except OSError as e:
        return [(STATUS_ERR, f"{rel}: impossibile statare il file: {e}")]

    problems = []  # messaggi; la severità viene applicata qui sotto

    expected_size = entry.get("size")
    if expected_size is not None and size != expected_size:
        problems.append(f"dimensione {size} != manifest ({expected_size})")

    fmt = entry.get("format") or FORMAT_BY_EXT.get(path.suffix.lower(), "unknown")

    if fmt == "gguf":
        problems.extend(validate_gguf(path, size))
    elif fmt == "safetensors":
        problems.extend(validate_safetensors(path, size))
    elif fmt == "pickle":
        verdict, data = validate_pickle(path, size)
        if verdict == "suspicious":
            occ = ", ".join(f"{k}={v}" for k, v in sorted(data.items()))
            return [(STATUS_WARN, f"{rel}: SOSPETTO pickle — pattern trovati: {occ}")]
        elif verdict == "error":
            problems.append(data)
    else:
        problems.append(f"formato sconosciuto '{fmt}'")

    # SHA-256 (solo scan completo e solo se non ci già problemi)
    if not quick and not problems:
        actual = sha256_of(path)
        if actual is None:
            problems.append("calcolo SHA-256 fallito (I/O)")
        else:
            expected_sha = entry.get("sha256")
            if expected_sha and expected_sha != actual:
                problems.append(
                    f"SHA-256 non corrispondente "
                    f"(manifest {expected_sha[:12]}… vs calcolato {actual[:12]}…)"
                )

    if not problems:
        return [(STATUS_OK, rel)]
    return [(sev, f"{rel}: {p}") for p in problems]


# ════════════════════ FILE NON REGISTRATI ════════════════════════════════

def scan_unregistered(registered):
    """Trova file modello su disco ma non nel manifest (registered = set di path)."""
    results = []
    if not MODELS_DIR.exists():
        return results
    for path in sorted(MODELS_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in MODEL_EXTS:
            continue
        rel = path.relative_to(MODELS_DIR).as_posix()
        if rel not in registered:
            results.append((STATUS_WARN,
                            f"{rel}: file modello non registrato nel manifest "
                            f"(possibile intruso)"))
    return results


# ════════════════════════════ SCAN / REPORT ═════════════════════════════

def _run_llm_audit():
    """Avvia l'audit di affidabilità con l'LLM locale (audit-model.py --audit-all).

    Restituisce l'exit code dello script figlio:
      0  tutti affidabili, 1  dubbio/warning, 2  malevolo/errore grave,
      3  giudice LLM non disponibile.
    """
    audit_script = PROJECT_DIR / "audit-model.py"
    cmd = [sys.executable, str(audit_script), "--audit-all", "--json"]
    print("\n[scan] avvio audit LLM (audit-model.py --audit-all) ...", file=sys.stderr)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    return proc.returncode


def run_scan(quick=False, llm=False):
    """Esegue lo scan completo del manifest + file non registrati.

    Se ``llm`` è attivo, alla fine dello scan deterministico viene avviato anche
    l'audit con l'LLM locale; l'exit code risultante tiene conto di entrambi.
    """
    try:
        manifest = load_manifest()
    except FileNotFoundError:
        print(f"[scan] manifest non trovato in {MANIFEST_PATH}", file=sys.stderr)
        print("[scan] esegui 'python scan-models.py --update' per crearlo.",
              file=sys.stderr)
        return 2
    except json.JSONDecodeError as e:
        print(f"[scan] manifest non valido JSON ({MANIFEST_PATH}): {e}", file=sys.stderr)
        return 2

    entries = manifest.get("files", [])
    registered = {e.get("path") for e in entries if e.get("path")}

    results = []
    for entry in entries:
        results.extend(validate_entry(entry, quick=quick))
    results.extend(scan_unregistered(registered))

    _print_report(results)
    code = _exit_code(results)

    if llm:
        audit_code = _run_llm_audit()
        # L'audit LLM influenza l'exit code dello scanner.
        if audit_code == 0:
            print("[scan] [audit] LLM: tutti affidabili")
        elif audit_code == 3:
            # giudice non disponibile: NON cambia l'exit code deterministico.
            print("[scan] [audit] giudice LLM non disponibile "
                  "(verifiche deterministiche comunque fatte)")
        elif audit_code == 2:
            code = 2
        elif audit_code == 1 and code < 1:
            code = 1

    return code


def _print_report(results):
    bar = "=" * 72
    sub = "-" * 72
    print(bar)
    print("  VERIFICA MODELLI — Palamede")
    print(bar)

    counts = {STATUS_OK: 0, STATUS_ERR: 0, STATUS_WARN: 0, STATUS_SUSP: 0}
    tags = {
        STATUS_OK: "[ OK ]", STATUS_ERR: "[ERRORE]",
        STATUS_WARN: "[WARNING]", STATUS_SUSP: "[SOSPETTO]",
    }
    if not results:
        print("  (nessuna entry nel manifest)")

    for status, msg in results:
        counts[status] = counts.get(status, 0) + 1
        print(f"  {tags.get(status, '[???? ]')} {msg}")

    print(sub)
    print(f"  Riepilogo: {counts[STATUS_OK]} OK, "
          f"{counts[STATUS_ERR]} errori, {counts[STATUS_WARN] + counts[STATUS_SUSP]} warning")
    print(bar)


def _exit_code(results):
    if any(s == STATUS_ERR for s, _ in results):
        return 2
    if any(s in (STATUS_WARN, STATUS_SUSP) for s, _ in results):
        return 1
    return 0


# ════════════════════════════ AGGIORNAMENTO ══════════════════════════════

def run_update():
    """Rigenera il manifest (MANIFEST_PATH) con gli hash attuali. I path scritti
    sono RELATIVI alla models-dir (MODELS_DIR)."""
    try:
        old = load_manifest()
    except FileNotFoundError:
        old = {"note": DEFAULT_NOTE, "files": []}
    except json.JSONDecodeError as e:
        print(f"[scan] manifest non valido JSON ({MANIFEST_PATH}): {e}", file=sys.stderr)
        print("[scan] interrompo l'aggiornamento per sicurezza.", file=sys.stderr)
        return 2

    by_path = {}
    for e in old.get("files", []):
        p = e.get("path")
        if p:
            by_path[p] = e

    found = []
    if MODELS_DIR.exists():
        for path in sorted(MODELS_DIR.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in MODEL_EXTS:
                continue
            rel = path.relative_to(MODELS_DIR).as_posix()
            try:
                size = path.stat().st_size
                digest = sha256_of(path)
            except OSError as e:
                print(f"[scan] saltato {rel}: {e}", file=sys.stderr)
                continue
            if digest is None:
                print(f"[scan] saltato {rel}: impossibile calcolare SHA-256", file=sys.stderr)
                continue

            fmt = FORMAT_BY_EXT[path.suffix.lower()]
            source = "auto"
            enforce = False
            existing = by_path.get(rel)
            if existing:
                # preservo i campi noti dell'entry esistente (match per path)
                enforce = bool(existing.get("enforce", False))
                source = existing.get("source", "auto")
                fmt = existing.get("format") or fmt

            found.append({
                "path": rel,
                "size": size,
                "sha256": digest,
                "format": fmt,
                "enforce": enforce,
                "source": source,
            })

    manifest = {
        "version": 1,
        "note": old.get("note") or DEFAULT_NOTE,
        "generated": date.today().isoformat(),
        "files": found,
    }
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    n_enforce = sum(1 for e in found if e["enforce"])
    print(f"[scan] manifest aggiornato: {len(found)} modelli "
          f"({n_enforce} enforce=true) in {MANIFEST_PATH}")
    return 0


# ════════════════════════════════ MAIN ═══════════════════════════════════

def main(argv=None):
    global MODELS_DIR, MANIFEST_PATH

    parser = argparse.ArgumentParser(
        prog="scan-models.py",
        description="Verifica di integrità dei modelli in models/ "
                    "(manifest RELATIVO alla models-dir).")
    parser.add_argument("--models-dir", default=None,
                         help="Directory dei modelli da scandire "
                              "(default: ../../models rispetto al progetto).")
    parser.add_argument("--manifest", default=None,
                        help="Path del manifest JSON (default: models.manifest.json).")
    parser.add_argument("--update", action="store_true",
                        help="Rigenera il manifest con gli hash attuali dei file.")
    parser.add_argument("--quick", action="store_true",
                        help="Salta il calcolo SHA-256 (solo esistenza+dimensione+formato).")
    parser.add_argument("--llm", action="store_true",
                        help="Alla fine dello scan esegue anche l'audit con l'LLM locale.")
    args = parser.parse_args(argv)

    if args.models_dir:
        MODELS_DIR = Path(args.models_dir).resolve()
    if args.manifest:
        MANIFEST_PATH = Path(args.manifest).resolve()

    if args.update:
        return run_update()
    return run_scan(quick=args.quick, llm=args.llm)


if __name__ == "__main__":
    sys.exit(main())
