# Palamede

Hub locale per modelli generativi sulla tua GPU. Una UI unica che parla con
più backend locali, una **coda** che tiene un solo modello occupato per
volta, e una **wiki** per ogni sezione con funzionamento, ingombri, tempi
misurati, qualità ed esempi generati dai modelli stessi.

**Stato**: la sezione **Immagini è operativa** con due modelli:
**Bonsai 4B ternary** e **Z-Image Turbo Q4_K_M**. Testo, Video, 3D, RAG e MCP
sono bozze con wiki.

## Requisiti

- Windows 11 x64, NVIDIA GPU con ≥ 12 GB VRAM (testato: RTX 5060 Ti 16 GB)
- Node.js ≥ 20, PowerShell 5.1, `uv` (per il venv Python di reference/bonsai)
- Driver NVIDIA recente (CUDA 12.8+)

## Struttura

```
Palamede/
  reference/      ← esterno, gitignored (repo bonsai sorgente con venv)
  models/         ← gitignored: pesi copiati da reference o scaricati
  tools/          ← gitignored: engine stable-diffusion.cpp (sd-server)
  backends/       ← backends.bonsai_backend.py (wrapper FastAPI con fix loader)
  hub/            ← server.mjs: statici + proxy + coda mutex GPU (zero deps)
  frontend/       ← Vite + React + TS (la UI)
  scripts/        ← setup, copy-models, start-*, stop-all
  outputs/        ← gitignored: immagini generate
  SPEC.md         ← architettura, contratti API, benchmark misurati
```

## Setup (una tantum)

```powershell
# 1. Prepara reference/bonsai (una tantum, ~15 GB): dentro reference/bonsai
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\reference\bonsai\setup.ps1

# 2. Copia/ricopia i pesi in models/ (da reference + download HF)
.\scripts\copy-models.ps1

# 3. Engine sd-cpp + dipendenze frontend + build UI
.\scripts\setup.ps1
```

## Avvio

Tre finestre PowerShell (o tre terminali):

```powershell
.\scripts\start-bonsai.ps1    # backend Bonsai  :8000
.\scripts\start-zimage.ps1    # backend Z-Image :8123 (sd-server)
.\scripts\start-hub.ps1       # hub web        :4600
```

Poi apri **http://127.0.0.1:4600**.

Alternativa rapida per la sola immagine senza UI:

```powershell
.\scripts\start-bonsai.ps1
$body = @{ model='bonsai'; prompt='a tiny bonsai tree on a wooden table, photo realistic';
           steps=4; seed=-1; width=512; height=512; count=1 } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:4600/api/image' -Method Post `
  -ContentType 'application/json' -Body $body
```

## API del hub

| Endpoint | Descrizione |
|---|---|
| `GET /api/health` | stato dei due backend |
| `POST /api/image` | `{model: "bonsai"\|"zimage", prompt, steps, seed, width, height, count}` → `{images:[{dataUrl,timeMs,seed,params}]}` |

La coda mutex è condivisa: **mai due generazioni simultanee sulla GPU**,
anche fra modelli diversi.

## Benchmark misurati (RTX 5060 Ti 16 GB, GPU dedicata)

| Modello | Risoluzione | Cold-shape | Warm |
|---|---|---|---|
| Bonsai ternary (4 step) | 512² | 4.0 s | **1.8 s** |
| Bonsai ternary (4 step) | 1024² | 19.4 s | **6.4 s** |
| Z-Image Q4 (8 step) | 512² | 5.6 s | **3.3 s** |
| Z-Image Q4 (8 step) | 1024² | 17.1 s | **17.8 s** |

I dettagli (ingombri, VRAM, qualità, prompt degli esempi) sono nella wiki
della pagina **Immagini** e in `SPEC.md`.

## Note

- Le dimensioni immagine devono essere **multipli di 32** (vincolo del VAE).
- La prima generazione a ogni risoluzione paga il JIT (10–30 s): i tempi
  "warm" sono quelli a regime, con le cache persistenti.
- `reference/` non va mai modificato: il fix al loader low-memory di bonsai
  vive nel wrapper `backends/bonsai_backend.py`.