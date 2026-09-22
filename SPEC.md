# Palamede — SPEC

## Cos'è

**Palamede** è un hub locale per l'esecuzione e il confronto di modelli di
generazione AI su una singola macchina (Windows + NVIDIA). Frontend web unico
che parla con più backend locali; ogni sezione (Immagini, Testo, 3D,
RAG, MCP) ha la sua **wiki** con funzionamento, ingombri, tempi misurati,
qualità ed esempi generati dai modelli stessi.

Stato attuale: **Immagini, Chat e RAG sono funzionanti** — quattro modelli
immagine (Bonsai 4B ternary, Z-Image Turbo Q4_K_M, Klein 4B FLUX.2 e
Qwen-Image 2.1 Q4_K_M), chat locale con Ornith
1.5 (35B-A3B e 9B) via llama.cpp, e una **knowledge base llm-wiki** (pattern
Karpathy) in `knowledge/` con fonti raw/ compilate dal modello in pagine
interconnesse, usate come contesto nella chat. Il **3D è integrato**: la
pipeline image-to-3D TRELLIS.2 produce un asset 3D completo da una singola
immagine (GLB texturizzato + STL). La sezione **MCP** resta bozza con wiki.

> **Struttura del progetto**: albero delle cartelle in **MAPPA.md**
> (rigenerato da `scripts/gen-mappa.ps1`); per l'uso operativo vedi **README.md**.

## Hardware di riferimento

| Risorsa | Valore |
|---|---|
| GPU | NVIDIA RTX 5060 Ti, 16 GB VRAM, driver 616.56 |
| RAM | 64 GB |
| OS | Windows 11 x64, PowerShell 5.1 |
| Runtime | Node 22, Python 3.11 (venv uv), CUDA 12.8 |

## Vincoli di design

1. **Un modello alla volta sulla GPU.** I backend restano in ascolto, ma il
   hub serializza le generazioni con una coda mutex: mai due richieste
   concorrenti verso due modelli. (VRAM combined ~14 GB su 16: fattibile ma
   rischioso; la coda rende il vincolo esplicito.)
2. **`reference/` è esterna al progetto** (repo/pesi sorgente). È in
   `.gitignore` e non deve mai essere toccata in scrittura dal progetto.
3. **I pesi usati dal progetto vivono in `models/`** (copiati da
   `reference/` o scaricati). Anch'essa è in `.gitignore`.
4. Gli **engine binari** (stable-diffusion.cpp) vivono in `tools/`,
   `.gitignore`ata: si scaricano con `scripts/setup.ps1`.
5. Le immagini generate dall'utente finiscono in `outputs/` (ignorata);
   gli **esempi della wiki** sono committati in `frontend/public/examples/`.
6. **Sorgenti ufficiali per tutto.** Non scaricare/installare mai pacchetti o
   file da fonti non ufficiali (utenti terzi su HuggingFace/GitHub, wheel
   precompilati da repo non ufficiali): si usa SOLO PyPI, il canale PyTorch
   ufficiale, i download ufficiali e i repo ufficiali (Microsoft/JeffreyXiang
   per TRELLIS). Per le dipendenze native di TRELLIS.2 (`o_voxel`, `flex_gemm`,
   `cumesh`) — codice e pesi presenti in `models/` — la via è la compilazione da
   sorgente dai repo ufficiali, MAI wheel di utenti terzi.

## Architettura

```
Browser ── http://127.0.0.1:4600 ── hub/server.mjs (Node, zero deps)
                                     ├─ statici: frontend/dist
                                     ├─ GET  /api/health     → stato modello server
                                     ├─ GET  /api/models     → cosa è caricato
                                     ├─ POST /api/select     → carica/scarica modello (coda)
                                     ├─ POST /api/image      → generazione (coda)
                                     ├─ GET  /api/metrics    → CPU/RAM/GPU (cache ~2.5s)
                                     ├─ GET  /api/chat/status → stato llama-server
                                     ├─ POST /api/chat/start  → avvia llama-server (parametri)
                                     ├─ POST /api/chat/stop   → ferma llama-server
                                     ├─ POST /api/chat        → chat streaming (SSE)
                                     ├─ GET/POST /api/kb/*    → knowledge base llm-wiki
                                     │
                                     ├─ UNICO backend: backends/modelserver.py :8000
                                     │    ├─ bonsai → GpuPipeline gemlite in-process
                                     │    └─ zimage → spawna/termina sd-server (:8123)
                                     │
                                     ├─ chat: tools/llama-cpp/llama-server.exe :8121
                                     │    (Ornith 1.5 35B-A3B / 9B, start su richiesta)
                                     │
                                     └─ knowledge/ (gitignored): raw/ + wiki/ + index/log
```

### Un solo backend, caricamento dinamico

Invece di tre processi fissi, **`modelserver.py`** (FastAPI :8000) possiede
entrambi i modelli e ne tiene **uno solo caricato**:

- `POST /select {"model":"bonsai"}` → scarica il corrente, carica la
  `GpuPipeline` gemlite (in-process, ~6 GB VRAM) e prewarma i 5 artifact.
- `POST /select {"model":"zimage"}` → scarica bonsai, **spawna sd-server**
  come subprocess (log in `outputs/sd-server.log`), aspetta la readiness.
- Deselezionare zimage **termina** sd-server → VRAM liberata.
- `POST /generate` auto-carica se il modello richiesto non è quello attivo.
- Un `threading.Lock` serializza tutto: mai due generazioni simultanee.

### Perchè Z-Image gira su `sd-server`

`z-image-turbo-Q4_K_M.gguf` è un GGUF architettura `lumina2` (solo il DiT).
L'engine che lo supporta ufficialmente è **stable-diffusion.cpp**
(riferimento nel README del progetto Z-Image di Tongyi Lab). Servono anche i
suoi due satelliti: text encoder **Qwen3-4B** (GGUF) e **VAE** (Flux-style,
presa dal repo ufficiale Z-Image-Turbo). API esposta internamente su
`POST /sdapi/v1/txt2img` (:8123), visibile solo quando il modello è caricato.

### Perchè il loader corretto vive in `backends/gemlite_loader.py`

Il repo `reference/bonsai` contiene un bug nel loader low-memory
(`scripts/local_backend.py`): con `gemlite>=0.6` le chiavi gemlite dei moduli
quantizzati risultano "missing" nel sanity-check post-carico → il server
crashia all'avvio. Il loader condiviso di Palamede reimplementa la versione
low-mem col filtro già presente nel loader upstream di `backend_gpu`
(`pipeline_gpu.py` righe 227-234), e viene applicato da `modelserver.py`
senza toccare `reference/`.

## Modelli installati (in `models/`, gitignored)

| Modello | File | Peso | Note |
|---|---|---|---|
| Bonsai 4B ternary | `bonsai-image-4B-ternary-gemlite/` | 4.24 GB | transformer int2 1.44 + TE HQQ-4bit 2.64 + VAE 0.16 |
| Z-Image Turbo Q4_K_M | `z-image-turbo-Q4_K_M.gguf` | 4.67 GB | DiT S3-DiT 6B |
| Qwen3-4B TE (per Z-Image) | `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` | 2.33 GB | text encoder |
| Z-Image VAE | `z-image-vae.safetensors` | 0.16 GB | bf16 |
| Qwen-Image 2.1 Q4_K_M | `qwen-image/qwen-image-2.1-Q4_K_M.gguf` | 4.2 GB | DiT single-stream 7B (sd-server) |
| Qwen3-VL-8B TE (per Qwen-Image) | `qwen-image/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf` | 5.1 GB | text encoder 8B |
| Qwen-Image 2.1 VAE | `qwen-image/qwen_image_2.1_vae_bf16.safetensors` | 0.68 GB | bf16 |
| Ornith 1.5 35B-A3B | `ornith-1.5-35b/Ornith-1.5-35B-Q4_K_M.gguf` | 20.2 GB | MoE (3B attivi), chat |
| Ornith 1.5 9B | `ornith-1.5-9b/Ornith-1.5-9B-Q4_K_M.gguf` | 5.2 GB | dense, chat |
| Ornith 1.5 9B Q5 | `ornith-1.5-9b/Ornith-1.5-9B-Q5_K_M.gguf` | 6.1 GB | dense, chat (qualità) |
| Bonsai 27B | `bonsai-27b/Bonsai-27B-Q1_0.gguf` | 3.5 GB | dense, chat (thinking opzionale) |

> **In bozza (`models/_inutilizzati/`)**: Wan 2.1 T2V 1.3B (+ VAE, UMT5-XXL) e Klein 9B BF16 sono sospesi, non referenziati dal codice.

### Dipendenze visione (non referenziate) — `models/trellis-deps/`

Due modelli di visione installati come pesi/dipendenze locali, **bozza per una
future pipeline visione** e **non ancora referenziati dal codice**:

| Modello | Percorso | File principali | Note |
|---|---|---|---|
| DINOv3 ViT (Meta AI) | `models/trellis-deps/dinov3/` | `model.safetensors` (~1.2 GB), `config.json`, `preprocessor_config.json` | ViT-B/16, hidden 1024, 24 layer, patch 16, size 224² — image feature extraction (torch_dtype float32). |
| BRIA RMBG-2.0 / BiRefNet (`ZhengPeng7/BiRefNet`) | `models/trellis-deps/rmbg2/` | `model.safetensors` (~885 MB), `pytorch_model.bin` (~885 MB), varianti ONNX in `onnx/`, `config.json`, `birefnet.py`, `BiRefNet_config.py` | Background removal (image-segmentation). Pesi PyTorch + 8 varianti ONNX (full, fp16, int8, uint8, q4, q4f16, bnb4, quantized). |

> Vivono in `models/trellis-deps/` (gitignored) e **non sono referenziati dal
> codice**: restano pesi/dipendenze pronti per una pipeline visione futura.

### TRELLIS.2 — generazione 3D da immagine (integrato)

**TRELLIS.2** è un modello generativo 3D di Microsoft (~4B parametri) che fa
**image-to-3D**: riceve **una singola immagine** e produce un **asset 3D
completo con mesh + materiali PBR**. È diviso in due parte presenti in
`models/`:

| Componente | Percorso | Contenuto | Peso |
|---|---|---|---|
| Codice sorgente (`trellis2/`) | `models/TRELLIS.2/` | package Python con `pipelines/trellis2_image_to_3d.py` + `trellis2_texturing.py`, `modules/sparse` (SparseTensor), `representations/{mesh,voxel}`, renderers e dipendenza C++ `o_voxel/` (Eigen + pybind11). Licenza MIT. ~37,5 MB, 2201 file. | — |
| Pesi ufficiali 4B (safetensors) | `models/TRELLIS.2-4B/` | `slat_flow_img2shape_dit_1_3B_{512,1024}_bf16`, `slat_flow_imgshape2tex_dit_1_3B_{512,1024}_bf16`, `ss_flow_img_dit_1_3B_64_bf16`, `shape_enc/dec_next_dc_f16c32_fp16`, `tex_enc/dec_next_dc_f16c32_fp16` + `README.md`, `pipeline.json`, `texturing_pipeline.json`. | ~15,12 GB (22 file) |

**Cosa fa**: rappresentazione **O-Voxel** (voxels sparsi field-free che
codificano geometria e aspetto), architettura **flow-matching transformer** +
**3D VAE sparso** (downsample 16×, risoluzioni da 512³ a 1536³). Le pipeline
nel codice sono `Trellis2ImageTo3DPipeline` (image→3D) e texturing.

#### Architettura reale (Palamede)

L'integrazione è **completa**: una pipeline image-to-3D funzionante con server
FastAPI dedicato, venv Python **separato** da quello bonsai, e frontend con
viewer + download.

| Pezzo | Dettaglio |
|---|---|
| Backend | `backends/trellis_server.py` — FastAPI su **:8124**, genera mesh texturizzate da immagine, esporta GLB (o_voxel) + STL (trimesh). Generazioni serializzate da un `threading.Lock`. |
| Venv | `reference/trellis-venv/` — Python **3.13**, torch **2.9.1+cu130**, triton-windows **3.5.1**, native compilate da sorgente (**flex_gemm, cumesh, o_voxel, nvdiffrast**). Il venv bonsai (`reference/bonsai`, torch 2.11+cu128) resta intatto. |
| Hub | `hub/server.mjs` spawna/termina il server 3D come subprocess (log in `outputs/trellis-server.log`) e serve i file prodotti da `outputs/3d/`. |
| Frontend | `frontend/src/pages/3d.svelte` — pagina `/3d`: upload immagine, qualità 512/1024, viewer three.js (dipendenza npm locale), download GLB + STL. Sidebar metriche con sezione **Server** per start/stop del server 3D. |
| Patch al codice TRELLIS.2 | supporto backend attenzione `sdpa` (`config.py` + `full_attn.py`, evita flash_attn non installato) e fix `image_feature_extractor.py` per transformers 5.16. |
| Setup | `scripts/setup-trellis.ps1` (deps pip + native da sorgente + decoder Stage1 RMBG2), `scripts/start-trellis.ps1` (avvio server). Porta **:8124**. |

**Endpoint** (tutti via hub :4600):

| Endpoint | Descrizione |
|---|---|
| `POST /api/3d/start` | avvia il server 3D TRELLIS (subprocess, coda mutex) |
| `POST /api/3d/stop` | ferma il server 3D |
| `GET /api/3d/status` | stato locale del subprocess (`running`, `ready`, `pid`, `load_time_s`) |
| `POST /api/3d/generate` | `{image(dataUrl), pipeline_type, seed, num_samples}` → asset 3D (coda mutex, timeout 15 min) |
| `GET /api/3d/file/<id>.{glb,stl}` | serve il file prodotto da `outputs/3d/` (attachment) |

**Formato risposta `/api/3d/generate`:** `{glb_base64, path, url (.glb), stl_url (.stl), vertices, faces, time_s, vram_peak_gb, seed, pipeline_type}`. Il GLB è texturizzato in **PNG** (NON WebP: `EXT_texture_webp` non supportato da Blender; PNG = compatibile). L'STL esporta la **solo geometria** (vertici+facce, niente texture — STL non le supporta) tramite trimesh.

#### Misurazioni reali (RTX 5060 Ti 16 GB)

Generazione a **512²**: ~**35–75 s** a regime; il **primo colpo** (caricamento
pipeline in VRAM) paga ~**90–280 s**. Picco VRAM ~**3,1 GB**; mesh ~**0,9–1,1 M**
vertici. A 1024² tempi e ingombri crescono con la risoluzione del voxel.

> **Kaspersky**: può bloccare lo spawn del server (falso positivo); se il
> `/api/3d/start` fallisce, aggiungi un'esclusione per la root del progetto.

### Chat locale (llama.cpp)

`tools/llama-cpp/llama-server.exe` (release b10679, CUDA 13.3) serve Ornith
con parametri scelti dalla UI:

- **contesto** (`-c`) 1024–65536, default 8192;
- **KV cache quantizzata** (`--cache-type-k/v`): `q8_0` consigliato, `q4_0`
  aggressivo, `f16` off;
- **MTP**: disattivato per default (`--spec-type` non impostato); l'opzione
  richiederebbe pesi del predittore non presenti;
- **layer MoE su CPU** (`--n-cpu-moe N`, solo per il 35B): sposta gli esperti
  dei primi N layer in RAM (64 GB) per liberare VRAM;
- **layer GPU** (`-ngl`), default 99 (full offload);
- `--flash-attn on`, `--no-warmup`.

Il server è **spento a default** e parte su `POST /api/chat/start` (porta
:8121, log in `outputs/text-server.log`). La risposta è **streaming SSE**
OpenAI-compatible; Ornith è un modello *reasoning*, quindi i token di pensiero
arrivano in `delta.reasoning_content` e la risposta in `delta.content` (la UI
mostra il ragionamento in un blocco a parte).

Il toggle "Thinking" nel pannello impostazioni della chat passa `--reasoning on|off` a llama-server (default: off, nessun ragionamento).

### Knowledge base llm-wiki (sezione RAG, `knowledge/`)

Pattern **LLM Wiki di Karpathy** invece del RAG vettoriale: le fonti grezze
vivono in `knowledge/raw/`, il modello le **compila** in pagine markdown
interconnesse in `knowledge/wiki/` con `index.md` (indice) e `log.md`
(registro append-only). La conoscenza è "compilata una volta" durante
l'ingest, non re-derivata a ogni domanda.

- La cartella `knowledge/` è gitignored (contenuto personale) e nasce al
  primo accesso con uno `SCHEMA.md` seed che istruisce il modello su come
  mantenere la wiki (stile pagine, formato di output a blocchi `<<<FILE>>>`).
- **Ingest**: la pagina RAG invia una fonte a `POST /api/kb/ingest`, il hub
  chiama llama-server (non-streaming) con system prompt = SCHEMA + fonte +
  index attuale; il modello risponde con i blocchi `<<<FILE wiki/...>>>`,
  `<<<INDEX>>>` e `<<<LOG>>>` che il hub scrive su disco.
- **Query nella chat**: toggle "knowledge on" → ogni domanda cerca le pagine
  wiki rilevanti (keyword search RAG-naive su `wiki/`, pesata per lunghezza
  dei termini) e le inietta come system prompt con l'istruzione di citare.
  L'`index.md` è il fallback quando nessuna pagina risulta rilevante.
- **Embeddings**: su questa macchina `embeddinggemma` è già installato su
  Ollama (`/api/embed`) — la UI lo segnala come "pronto per RAG vettoriale",
  ma la ricerca corrente è keyword (zero dipendenze). L'upgrade vettoriale
  è la strada quando la wiki cresce oltre ~centinaia di pagine.

## Contratti API del hub

### `GET /api/health`

```json
{ "ok": true, "current": "bonsai", "zimage_process": false }
```

### `GET /api/models` — stato dei modelli

```json
{ "current": "bonsai",
  "models": [ { "id": "bonsai", "name": "…", "engine": "…", "loaded": true },
              { "id": "zimage", "name": "…", "engine": "…", "loaded": false } ] }
```

### `POST /api/select`

Carica/scarica il modello (bloccante finché non è pronto; il server scarica
il modello corrente e libera la VRAM prima di caricare il nuovo).

```json
// request                  // response (= GET /api/models)
{ "model": "bonsai" }  →    { "current": "bonsai", "models": […] }
```

### `POST /api/image`

```json
// request
{ "model": "bonsai" | "zimage",
  "prompt": "…", "steps": 4, "seed": 42,
  "width": 512, "height": 512, "count": 1 }
// response
{ "images": [ { "dataUrl": "data:image/png;base64,…",
                "timeMs": 1834, "seed": 42 } ] }
```

- `seed: -1` → seed casuale vero (SystemRandom) generato dal modello
  server, restituito in risposta.
- `count>1` → generazione seriale (seed incrementali), la coda è comunque
  one-shot per richiesta.
- Auto-carica il modello se non è quello attivo (defensivo; la UI chiama
  `/select` esplicitamente per mostrare lo stato di caricamento).
- Errori: `400` parametri non validi / `500` modello server o crash.

### `GET /api/metrics` — CPU/RAM/GPU

```json
{ "ts": 1690000000000, "cpu": 23.5,
  "ram": { "usedGB": 21.4, "totalGB": 63.7, "pct": 33.6 },
  "gpu": { "ok": true, "utilPct": 12, "vramUsedGB": 5.6, "vramTotalGB": 16.0,
           "vramPct": 35, "tempC": 52, "powerW": 88,
           "procs": [ { "name": "python.exe", "mem": "5432MiB" } ] } }
```

Cache nel hub (~2.5 s): `nvidia-smi` per GPU/VRAM/proc, `Get-CimInstance
Win32_Processor` per la CPU (rapido, niente counter lento da ~1s), API `os`
di Node per la RAM. Tutte le risposte `/api` viaggiano con
`Cache-Control: no-store` (mai metriche o stati stantii nel browser);
`index.html` con `no-cache`.

Robustezza: ogni valore passa per un parse "safe" — i campi `N/A` di
nvidia-smi (tipico `power.draw` a riposo) diventano `0` invece di `NaN`, che
avrebbe rotto il JSON (la sidebar mostrava `nullW`/`NaN°C`). Se la CPU esce a
`0` a riposo si tiene l'ultimo valore noto, senza buchi in UI.

### Parametri nativi dei backend

### API knowledge base — `/api/kb/*`

| Endpoint | Descrizione |
|---|---|
| `GET /api/kb/status` | stato: conteggi raw/wiki, contenuto index.md, log.md, SCHEMA.md, stato chat |
| `GET /api/kb/files?area=raw\|wiki` | elenco file (ricorsivo, path relativi) |
| `GET /api/kb/read?path=…` | contenuto di un file (solo dentro `knowledge/`, path traversal → 403) |
| `POST /api/kb/save` | `{path, content}` — scrive in `raw/` o `wiki/` (solo .md/.txt) |
| `POST /api/kb/delete` | `{path}` — elimina una fonte in `raw/` |
| `GET /api/kb/search?q=…` | keyword search sulle pagine wiki → `{pages: [path…]}` |
| `POST /api/kb/ingest` | `{source}` — compila una fonte raw/ nella wiki via llama-server |
| `GET /api/kb/embeddings` | disponibilità Ollama (embeddinggemma) per il futuro RAG vettoriale |

L'ingest richiede **llama-server attivo** (stesso modello della chat); la
risposta del modello viene parsata sui blocchi `<<<FILE …>>>` / `<<<INDEX>>>` /
`<<<LOG>>>` e scritta su disco; se il formato non è rispettato la risposta
grezza finisce in `wiki/sources/<nome>-raw.md` con un errore esplicito.

| | Bonsai (gemlite in-process) | Z-Image (sd-server :8123) |
|---|---|---|
| chiamata interna | `GpuPipeline.generate_png(prompt, seed, steps, width, height)` | `POST /sdapi/v1/txt2img` → `{images:[b64]}` |
| steps | default 4 | default 8 (distilled) |
| cfg | n/d (distilled) | `cfg_scale` 1.0 (= effettivo 0) |
| seed | esplicito (il hub genera se -1) | esplicito |
| extra | — | — |

## Dati di performance MISURATI (RTX 5060 Ti)

Generazione esclusiva (un solo modello residente sulla GPU), warm = forma
gia' scaldata (JIT/autotune in cache), cold = primo uso di una risoluzione.

| Modello | Risoluzione | Cold-shape | Warm | VRAM residente |
|---|---|---|---|---|
| Bonsai ternary (4 step) | 512² | 4.0 s | **1.8 s** | ~6 GB |
| Bonsai ternary (4 step) | 1024² | 19.4 s | **6.4 s** | ~6 GB |
| Z-Image Q4 (8 step) | 512² | 5.6 s | **3.3 s** | ~8.5 GB |
| Z-Image Q4 (8 step) | 1024² | 17.1 s | **17.8 s** | ~8.5 GB |

Nota JIT: la prima generazione a una nuova risoluzione paga Triton
JIT/autotune (cache persistite in `outputs/.triton_cache` e
`outputs/.gemlite_cache` del backend bonsai).

## Frontend

Vite + Svelte 5 + TypeScript, router custom hash-based (zero deps extra),
CSS vanilla con design system "officina a inchiostro": sumi-ink scuro, carta
invecchiata, accenti ocra/vermiglio, Fraunces (display) + IBM Plex
(Sans/Mono). `npm run dev` proxya `/api` al hub :4600.

**Stato condiviso** in `frontend/src/store.svelte.ts`: un solo poller per tutta
l'app (health + modelli + metriche + chat ogni 3 s, senza overlap e in pausa a
scheda nascosta) esposto via runes `$state`, così
sidebar, home e pagina immagini mostrano sempre lo stesso stato. Il cambio
modello è un solo punto (`switchModel(id)`): il server scarica il precedente
e carica il nuovo su `/select` — **non serve mai premere un "eject" prima di
cambiare modello**. Auto-routing in `App.svelte`: ogni file in `pages/*.svelte`
diventa una rotta (`Home` → `/`).

Pagine:

| Rotta | Contenuto |
|---|---|
| `/` | Home hub: eroe compatto (headline + **registro di bordo live**: backend, modello in VRAM, barra GPU) · **card Applicazioni subito visibili** · sotto, **Le applicazioni nel dettaglio** con le descrizioni · in coda **Misure sul banco** |
| `/images` | Generatore funzionante (due modelli) + gallery locale + wiki dei due modelli con esempi reali |
| `/chat` | **Chat funzionante**: Ornith 35B-A3B / 9B / 9B-Q5, streaming con ragionamento mostrato, impostazioni (contesto, KV quant, MTP, layer MoE su CPU, layer GPU, temperatura, toggle thinking (default off)), avvio/stop server, **toggle knowledge on** per usare la wiki come contesto |
| `/rag` | **Knowledge base llm-wiki funzionante**: aggiungi fonti in `knowledge/raw/`, compilale nella wiki col modello, ispeziona pagine/index/log/schema, cerca nelle pagine |
| `/3d` | **Generatore 3D funzionante**: upload immagine, qualità 512/1024, viewer three.js, download GLB + STL, sezione Server per start/stop del server TRELLIS. |
| `/mcp` | Bozza: wiki del tipo di modello + checklist requisiti + stato non installato. |

## Script

| Script | Ruolo |
|---|---|
| `scripts/start.ps1` + `start.bat` | **avvio a un comando**: controlla cosa è attivo, avvia il resto, apre il browser |
| `scripts/setup.ps1` | one-time: npm install, build frontend, scarica tools/sd-cpp **e tools/llama-cpp** |
| `scripts/copy-models.ps1` | ricopia i pesi da `reference/` in `models/` |
| `scripts/start-backend.ps1` | UNICO modello server :8000 (caricamento dinamico bonsai/zimage) |
| `scripts/start-hub.ps1` | node hub/server.mjs :4600 (statici+proxy+metriche+chat) |
| `scripts/stop-all.ps1` + `stop.bat` | ferma hub, modello server (e subprocess sd-server) e llama-server |

Avvio nascosto: backend e hub partono **senza finestre console** (switch
`-Hidden`; launcher con `WindowStyle Hidden`) e scrivono i log in
`outputs/backend.log` e `outputs/hub.log`. `scripts/start.ps1 -Visible`
ripristina le console per il debug.

## Decisioni prese

- **L'officina è un'app desktop nativa (Tauri v2)**: `Palamede.exe` (~6 MB)
  è una webview WebView2 che avvia i servizi locali (hub node :4600 + modello
  server :8000) come processi nascosti. Comportamento **tray** stile WhatsApp:
  chiudere la finestra nasconde l'app e i servizi continuano; dal tray
  "Ferma tutto ed esci" li termina. Un **Job Object Windows**
  (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) termina automaticamente i figli se
  l'app muore per qualsiasi motivo → niente RAM/VRAM lasciate per strada.
  Il frontend è servito dall'hub (same-origin per `/api`), non incorporato
  nel binario: zero CORS/proxy e zero cambi alle API.

- **Non tocca `reference/`**: è repo altrui, gitignored e volatile; il fix
  del bug bonsai vive nel loader condiviso di Palamede
  (`backends/gemlite_loader.py`).
- **Un solo backend**: `modelserver.py` possiede i modelli e li carica/scarica
   su `/select`, così la VRAM non è mai condivisa tra modelli e non servono
   tre processi da avviare a mano.
- **App desktop nativa Tauri v2**: `Palamede.exe` (~6 MB) sostituisce il
  vecchio launcher .NET+browser (archiviato in legacy/). Avvia i servizi nascosti, mostra la UI in
  una finestra WebView2 e resta nel **tray** (chiudere la finestra non ferma
  i servizi; "Ferma tutto ed esci" dal tray li termina). Un **Job Object
  Windows** (KILL_ON_JOB_CLOSE) termina i figli anche se l'app muore
  brutalmente → RAM/VRAM sempre liberate. Notifiche native via
  `tauri-plugin-notification` (invocate dal frontend con `window.__TAURI__`).
- **Zero dipendenze runtime nel hub** (`node:http`) e **zero dipendenze
  frontend extra** oltre Vite/React: un `npm install` e via.
- **Hash-routing** invece di react-router: 6 pagine, un listener
  `hashchange` basta (YAGNI).
- **La coda è nel hub e nel server** (lock + catena di promise): il vincolo
  di esclusività GPU è una regola di prodotto, non un'abitudine di avvio.
- **Metriche di sistema nel hub** (nvidia-smi + Win32_Processor + os):
  la sidebar della UI le mostra senza dipendenze esterne; parse "safe"
  contro i `N/A` di nvidia-smi.
- **Un solo poller frontend** (`store.ts`): niente stati locali desincronizzati
  tra sidebar e pagine; il cambio modello è one-click, il server scarica il
  precedente da sé (nessun tasto "eject").
- I dati della wiki sono **misurati su questa macchina**, non copiati dai
  model card (le cifre ufficiali "sub-second" si intendono su H800).