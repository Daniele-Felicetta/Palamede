# Palamede — SPEC

## Cos'è

**Palamede** è un hub locale per l'esecuzione e il confronto di modelli di
generazione AI su una singola macchina (Windows + NVIDIA). Frontend web unico
che parla con più backend locali; ogni sezione (Immagini, Testo, Video, 3D,
RAG, MCP) ha la sua **wiki** con funzionamento, ingombri, tempi misurati,
qualità ed esempi generati dai modelli stessi.

Stato attuale: la sezione **Immagini è funzionante** con due modelli
(Bonsai 4B ternary, Z-Image Turbo Q4_K_M). Le altre sezioni sono bozze con
wiki, in attesa dei modelli.

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

## Architettura

```
Browser ── http://127.0.0.1:4600 ── hub/server.mjs (Node, zero deps)
                                     ├─ statici: frontend/dist
                                     ├─ GET  /api/health     → stato modello server
                                     ├─ GET  /api/models     → cosa è caricato
                                     ├─ POST /api/select     → carica/scarica modello (coda)
                                     ├─ POST /api/image      → generazione (coda)
                                     ├─ GET  /api/metrics    → CPU/RAM/GPU (cache ~2.5s)
                                     │
                                     └─ UNICO backend: backends/modelserver.py :8000
                                          ├─ bonsai → GpuPipeline gemlite in-process
                                          └─ zimage → spawna/termina sd-server (:8123)
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

- `seed: -1` → seed casuale generato dal hub e restituito in risposta.
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
di Node per la RAM.

Robustezza: ogni valore passa per un parse "safe" — i campi `N/A` di
nvidia-smi (tipico `power.draw` a riposo) diventano `0` invece di `NaN`, che
avrebbe rotto il JSON (la sidebar mostrava `nullW`/`NaN°C`). Se la CPU esce a
`0` a riposo si tiene l'ultimo valore noto, senza buchi in UI.

### Parametri nativi dei backend

| | Bonsai (gemlite in-process) | Z-Image (sd-server :8123) |
|---|---|---|
| chiamata interna | `GpuPipeline.generate_png(prompt, seed, steps, width, height)` | `POST /sdapi/v1/txt2img` → `{images:[b64]}` |
| steps | default 4 | default 8 (distilled) |
| cfg | n/d (distilled) | `cfg_scale` 1.0 (= effettivo 0) |
| seed | esplicito (il hub genera se -1) | esplicito |

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

Vite + React 18 + TypeScript, router custom hash-based (zero deps extra),
CSS vanilla con design system "officina a inchiostro": sumi-ink scuro, carta
invecchiata, accenti ocra/vermiglio, Fraunces (display) + IBM Plex
(Sans/Mono). `npm run dev` proxya `/api` al hub :4600.

**Stato condiviso** in `frontend/src/store.ts`: un solo poller per tutta
l'app (health + modelli + metriche ogni 3 s) esposto via `useStore()`, così
sidebar, home e pagina immagini mostrano sempre lo stesso stato. Il cambio
modello è un solo punto (`switchModel(id)`): il server scarica il precedente
e carica il nuovo su `/select` — **non serve mai premere un "eject" prima di
cambiare modello**.

Pagine:

| Rotta | Contenuto |
|---|---|
| `/` | Home hub: eroe compatto (headline + **registro di bordo live**: backend, modello in VRAM, barra GPU) · **card Applicazioni subito visibili** · sotto, **Le applicazioni nel dettaglio** con le descrizioni · in coda **Misure sul banco** |
| `/images` | Generatore funzionante (due modelli) + gallery locale + wiki dei due modelli con esempi reali |
| `/text`, `/video`, `/3d`, `/rag`, `/mcp` | Bozze: wiki del tipo di modello + checklist requisiti + stato non installato |

## Script

| Script | Ruolo |
|---|---|
| `scripts/start.ps1` + `start.bat` | **avvio a un comando**: controlla cosa è attivo, avvia il resto, apre il browser |
| `scripts/setup.ps1` | one-time: npm install, build frontend, scarica tools/sd-cpp |
| `scripts/copy-models.ps1` | ricopia i pesi da `reference/` in `models/` |
| `scripts/start-backend.ps1` | UNICO modello server :8000 (caricamento dinamico bonsai/zimage) |
| `scripts/start-hub.ps1` | node hub/server.mjs :4600 (statici+proxy+metriche) |
| `scripts/stop-all.ps1` + `stop.bat` | ferma hub e modello server (e subprocess sd-server) |

Avvio nascosto: backend e hub partono **senza finestre console** (switch
`-Hidden`; launcher con `WindowStyle Hidden`) e scrivono i log in
`outputs/backend.log` e `outputs/hub.log`. `scripts/start.ps1 -Visible`
ripristina le console per il debug.

## Decisioni prese

- **Non tocca `reference/`**: è repo altrui, gitignored e volatile; il fix
  del bug bonsai vive nel loader condiviso di Palamede
  (`backends/gemlite_loader.py`).
- **Un solo backend**: `modelserver.py` possiede i modelli e li carica/scarica
  su `/select`, così la VRAM non è mai condivisa tra modelli e non servono
  tre processi da avviare a mano.
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