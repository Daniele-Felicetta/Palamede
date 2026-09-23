# Palamede

Hub locale per modelli generativi sulla tua GPU. Una UI unica con **sidebar
metriche** (CPU/RAM/GPU), un **unico backend dinamico** che carica il modello
giusto quando lo selezioni (mai due modelli in VRAM insieme), e una **wiki**
per ogni sezione con funzionamento, ingombri, tempi misurati, qualità ed
esempi generati dai modelli stessi.

**Stato**: **Immagini**, **Chat** e **RAG** sono operative: quattro
modelli immagine (**Bonsai 4B ternary**, **Z-Image Turbo Q4_K_M**, **Klein 4B
FLUX.2** e **Qwen-Image 2.1 Q4_K_M**), chat
locale con **Ornith 1.5** via llama.cpp, e una **knowledge base RAG in stile
NotebookLM** in `knowledge/` — fonti spezzate in chunk ed embedded localmente,
interrogate con retrieval ibrido + rerank (MiniCPM 2B) e risposte grounded con
citazioni cliccabili. Il **3D** è
ora **operativo**: la pipeline image-to-3D **TRELLIS.2** genera un asset 3D
(completo di mesh + materiali PBR) da una singola immagine, esportato in GLB
texturizzato e STL (solo geometria); la pagina `/3d` ha viewer three.js e
download dei file. La sezione **MCP** resta bozza con wiki.

## Requisiti

- Windows 11 x64, NVIDIA GPU con ≥ 12 GB VRAM (testato: RTX 5060 Ti 16 GB)
- Node.js ≥ 20, PowerShell 5.1, `uv` (per il venv Python di reference/bonsai)
- Driver NVIDIA recente (CUDA 12.8+)
- Per la build dell'exe: **Rust** (cargo) + MSVC Build Tools (per Tauri)

## Struttura

Le cartelle in sintesi; per l'albero completo, manutenuto automaticamente,
vedi **MAPPA.md** (si rigenera con `.\scripts\gen-mappa.ps1`).

- `backends/` — modelserver.py (unico backend dinamico) + gemlite_loader.py + requirements.txt
- `hub/` — server.mjs: statici + proxy + metriche + coda GPU + chat + knowledge + 3D
- `frontend/` — Vite + Svelte 5 + TS (la UI)
- `src-tauri/` — app desktop nativa Tauri v2 (tray + notifiche + Job Object)
- `scripts/` — setup, copy-models, start-*, stop-all, build, watch, gen-mappa
- `legacy/` — vecchio launcher .NET archiviato (non più usato)
- gitignored: `reference/`, `models/`, `tools/`, `knowledge/`, `outputs/`
  - `models/trellis-deps/` contiene anche DINOv3 (Meta) + BRIA RMBG-2.0 (BiRefNet): dipendenze di visione non ancora usate dal codice.
  - `models/TRELLIS.2/` = codice sorgente TRELLIS.2 di Microsoft (~37,5 MB, licenza MIT): pipeline image-to-3D + texturing. **Integrato** via `backends/trellis_server.py` (patch per il backend `sdpa` e fix transformers 5.16).
  - `models/TRELLIS.2-4B/` = pesi ufficiali 4B in safetensors (~15,12 GB) per la generazione 3D da immagine. **Integrati** (backend TRELLIS operativo).
  - `reference/trellis-venv/` = venv **separato** di TRELLIS (Python 3.13, torch 2.9.1+cu130, triton-windows 3.5.1 + native compilate da sorgente: flex_gemm, cumesh, o_voxel, nvdiffrast). Il backend bonsai (`reference/bonsai`, torch 2.11+cu128) resta intatto.

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

# 4. (una tantum) venv TRELLIS per la generazione 3D: deps pip + native da
#    sorgente + decoder Stage1. Popola reference/trellis-venv (~20+ GB).
.\scripts\setup-trellis.ps1
```

## Avvio

**Un comando solo** (o doppio clic su `start.bat` alla radice):

```powershell
.\scripts\start.ps1
```

**Oppure con il launcher**: doppio clic su **`Palamede.exe`** (alla radice) —
una **app desktop nativa Tauri v2** (~6 MB) che avvia i servizi nascosti,
mostra la UI in una finestra propria e **resta nel tray** (in basso a destra,
stile WhatsApp): chiudere la finestra non spegne l'officina, i servizi
continuano; dal tray con "Ferma tutto ed esci" (o clic destro) si termina
tutto liberando RAM e VRAM. Notifiche native di sistema alla fine delle
generazioni. Si rigenera con `.\scripts\build.ps1` (serve Rust + MSVC).

Backend e hub girano **senza finestre visibili** e scrivono i log in
`outputs/backend.log` e `outputs/hub.log` (per vedere la console: avvia gli
script senza `-Hidden`, es. `.\scripts\start-backend.ps1`).

Lo script/launcher controlla cosa è già attivo, avvia ciò che manca e apre
la finestra su **http://127.0.0.1:4600**.

Per fermare tutto: `.\scripts\stop-all.ps1` (o `stop.bat`, o il pulsante
nel launcher).

> Vuoi che parta all'accesso? Metti un collegamento a `start.bat` (o a
> `Palamede.exe`) nella cartella avvio (`Win+R` → `shell:startup`).

## Build dell'exe (Tauri)

L'exe è una **app desktop nativa Tauri v2** (Rust): niente più bundle .NET,
niente estrazione al primo avvio — i sorgenti (hub, backends, frontend) e i
pesi (models/, tools/) restano file in locale e l'exe li avvia.

```powershell
# 1) Un comando solo: frontend + exe Tauri (aggiorna Palamede.exe)
.\scripts\build.ps1

# 2) Watch: rigenera automaticamente l'exe a ogni salvataggio nei sorgenti
.\scripts\watch.ps1
```

`watch.ps1` osserva i sorgenti con un debounce di 2 s, ricompila
(`build.ps1`) e resta in ascolto. Opzioni:

```powershell
.\scripts\build.ps1 -SkipFrontend    # solo rebuild dell'exe Tauri (UI già costruita)
.\scripts\watch.ps1 -SkipFrontend    # watch senza ricompilare la UI a ogni colpo
```

**Attenzione**: la build incorpora il frontend `dist` nella config Tauri e
l'exe avvia i servizi dalla root; se `Palamede.exe` è in esecuzione,
`build.ps1` lo chiude prima di sovrascriverlo. Se un antivirus (es.
Kaspersky) blocca gli `.exe` appena compilati, aggiungi un'esclusione per
`src-tauri/target` e per la root del progetto.

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
| `POST /api/select` | carica/scarica `{model: "bonsai"\|"zimage"\|"klein"\|"qwenimage"}` |
| `POST /api/image` | `{model, prompt, steps, seed, width, height, count}` → `{images:[{dataUrl,timeMs,seed}]}` |
| `GET /api/metrics` | CPU/RAM/GPU (usata dalla sidebar) |
| `GET /api/chat/status` | stato del server chat (llama-server) |
| `POST /api/chat/start` | avvia llama-server `{model, context, kv, mtp, cpuMoe, gpuLayers}` |
| `POST /api/chat/stop` | ferma llama-server |
| `POST /api/chat` | chat streaming SSE (accetta anche `messages` con `system`) |
| `GET/POST /api/kb/*` | knowledge base RAG: status, files, read, save, upload, delete, ingest, search, retrieve, embeddings, rerank |

La coda mutex è condivisa: **mai due generazioni simultanee sulla GPU**,
e il backend stesso libera la VRAM quando cambi modello.

### Knowledge base (RAG) — sezione RAG

RAG vettoriale in stile **NotebookLM**: le fonti grezze stanno in
`knowledge/raw/`, vengono spezzate in **chunk** ed **embedded** localmente
(Ollama `embeddinggemma`). Ogni domanda recupera i frammenti rilevanti
(retrieval ibrido coseno + keyword fusi con RRF, poi **rerank** col modello
dedicato MiniCPM 2B, llama-server separato `:8123` che si spegne da solo
dopo ~60s di inattività) e il modello risponde **solo da quelli**, citando
`[n]` cliccabili che aprono la fonte con il passaggio evidenziato.

1. Vai su **RAG** → aggiungi una fonte (incolla testo o drag&drop `.md/.txt`):
   viene salvata in `knowledge/raw/` e indicizzata subito.
2. In **RAG** chiedi direttamente nella chat "con le tue fonti" — oppure
3. In **Chat** attiva **knowledge on**: ogni domanda recupera i frammenti
   rilevanti dalle tue fonti e risponde con citazioni.

Se Ollama è spento l'ingest salva i chunk senza vettore e la ricerca degrada
a keyword (un nuovo "ri-embed" li embedda); se il reranker è giù, restano i
top del ranking ibrido. Eliminare una fonte rimuove anche i suoi chunk
dall'indice.

## Benchmark misurati (RTX 5060 Ti 16 GB, GPU dedicata)

| Modello | Risoluzione | Cold-shape | Warm |
|---|---|---|---|
| Bonsai ternary (4 step) | 512² | 4.0 s | **1.8 s** |
| Bonsai ternary (4 step) | 1024² | 19.4 s | **6.4 s** |
| Z-Image Q4 (8 step) | 512² | 5.6 s | **3.3 s** |
| Z-Image Q4 (8 step) | 1024² | 17.1 s | **17.8 s** |

I dettagli (ingombri, VRAM, qualità, prompt degli esempi) sono nella wiki
delle pagine **Immagini** e in `SPEC.md`.

## Note

- Le dimensioni immagine devono essere **multipli di 32** (vincolo del VAE).
- La prima generazione a ogni risoluzione paga il JIT (10–30 s): i tempi
  "warm" sono quelli a regime, con le cache persistenti.
- `reference/` non va mai modificato: il fix al loader low-memory di bonsai
  vive in `backends/gemlite_loader.py`.
- Scaricare/installare **SOLO da fonti ufficiali** (repo ufficiali PyPI,
  canale PyTorch ufficiale, download ufficiali): MAI utenti terzi su
  HuggingFace/GitHub né wheel precompilati da repo non ufficiali. Per TRELLIS.2
  le dipendenze native (`o_voxel`, `flex_gemm`, `cumesh`) si compilano da
  sorgente dai repo ufficiali, senza wheel di terze parti.