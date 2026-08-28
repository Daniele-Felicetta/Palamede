# Palamede

Hub locale per modelli generativi sulla tua GPU. Una UI unica con **sidebar
metriche** (CPU/RAM/GPU), un **unico backend dinamico** che carica il modello
giusto quando lo selezioni (mai due modelli in VRAM insieme), e una **wiki**
per ogni sezione con funzionamento, ingombri, tempi misurati, qualità ed
esempi generati dai modelli stessi.

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
  backends/       ← modelserver.py (unico backend dinamico) + gemlite_loader.py
  hub/            ← server.mjs: statici + proxy + metriche + coda GPU
  frontend/       ← Vite + React + TS (la UI)
  scripts/        ← setup, copy-models, start-*, stop-all
  outputs/        ← gitignored: immagini generate, log sd-server
  SPEC.md         ← architettura, contratti API, benchmark misurati
```

### Caricamento dinamico dei modelli

C'è **un solo backend** (`backends/modelserver.py`, :8000): tiene in VRAM
**un modello alla volta** e lo cambia su selezione.

- Selezioni **Bonsai** → il server carica la `GpuPipeline` gemlite (~6 GB).
- Selezioni **Z-Image** → scarica bonsai e **spawna sd-server** come
  subprocess (~8.5 GB); deselezionando, lo termina e libera la VRAM.
- La sidebar mostra CPU/RAM/GPU/VRAM in tempo reale e il modello attivo.

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

**Un comando solo** (o doppio clic su `start.bat` alla radice):

```powershell
.\scripts\start.ps1
```

**Oppure con il launcher**: doppio clic su **`Palamede.exe`** (alla radice) —
una piccola finestra mostra l'avvio, apre il browser da sola e ha il pulsante
"Ferma tutto". Si rigenera con `.\scripts\build-launcher.ps1` (usa il
compilatore .NET Framework già presente in Windows, ~12 KB, niente install).

Lo script/launcher controlla cosa è già attivo, avvia ciò che manca in
finestre minimizzate e apre il browser su **http://127.0.0.1:4600**.

Per fermare tutto: `.\scripts\stop-all.ps1` (o `stop.bat`, o il pulsante
nel launcher).

> Vuoi che parta all'accesso? Metti un collegamento a `start.bat` nella
> cartella avvio (`Win+R` → `shell:startup`).

Avvio manuale, se preferisci:

```powershell
.\scripts\start-backend.ps1    # unico modello server :8000 (caricamento dinamico)
.\scripts\start-hub.ps1        # hub web               :4600
```

Alternativa rapida per la sola immagine senza UI:

```powershell
.\scripts\start-backend.ps1
$body = @{ model='bonsai'; prompt='a tiny bonsai tree on a wooden table, photo realistic';
           steps=4; seed=-1; width=512; height=512; count=1 } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:4600/api/image' -Method Post `
  -ContentType 'application/json' -Body $body
```

## API del hub

| Endpoint | Descrizione |
|---|---|
| `GET /api/health` | stato del modello server + modello caricato |
| `GET /api/models` | elenco modelli e quale è caricato |
| `POST /api/select` | carica/scarica `{model: "bonsai"\|"zimage"}` |
| `POST /api/image` | `{model, prompt, steps, seed, width, height, count}` → `{images:[{dataUrl,timeMs,seed}]}` |
| `GET /api/metrics` | CPU/RAM/GPU (usata dalla sidebar) |

La coda mutex è condivisa: **mai due generazioni simultanee sulla GPU**,
e il backend stesso libera la VRAM quando cambi modello.

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
  vive in `backends/gemlite_loader.py`.