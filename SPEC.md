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
                                     ├─ GET  /api/health   → probe dei backend
                                     ├─ POST /api/image    → coda mutex
                                     │    ├─ bonsai → http://127.0.0.1:8000/generate   (PNG raw)
                                     │    └─ zimage → http://127.0.0.1:8123/sdapi/v1/txt2img (b64 JSON)
                                     └─ tutto il resto: 404 JSON

Backend Bonsai  : uvicorn backends.bonsai_backend:app :8000  (Python, venv di reference/bonsai)
Backend Z-Image : tools/sd-cpp/sd-server.exe :8123           (GGUF lumina2, --diffusion-fa)
```

### Perchè `backends/bonsai_backend.py`

Il repo `reference/bonsai` contiene un bug nel loader low-memory
(`scripts/local_backend.py`): con `gemlite>=0.6` le chiavi gemlite dei moduli
quantizzati risultano "missing" nel sanity-check post-carico → il server
crashia all'avvio. Il wrapper Palamede reimplementa il loader con il filtro
già presente nel loader upstream di `backend_gpu` (`pipeline_gpu.py`
righe 227-234), senza toccare `reference/`.

### Perchè `sd-server` per Z-Image

`z-image-turbo-Q4_K_M.gguf` è un GGUF architettura `lumina2` (solo il DiT).
L'engine che lo supporta ufficialmente è **stable-diffusion.cpp**
(riferimento nel README del progetto Z-Image di Tongyi Lab). Servono anche i
suoi due satelliti: text encoder **Qwen3-4B** (GGUF) e **VAE** (Flux-style,
presa dal repo ufficiale Z-Image-Turbo). API esposta: `POST /sdapi/v1/txt2img`
(A1111-compatibile) e `/v1/...` (OpenAI-compatibile).

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
{ "bonsai": { "ok": true, "family": "bonsai-ternary" },
  "zimage": { "ok": true } }
```

### `POST /api/image`

```json
// request
{ "model": "bonsai" | "zimage",
  "prompt": "…", "steps": 4, "seed": 42,
  "width": 512, "height": 512, "count": 1 }
// response
{ "images": [ { "dataUrl": "data:image/png;base64,…",
                "timeMs": 1834, "seed": 42,
                "params": { …eco della richiesta… } } ] }
```

- `seed: -1` → seed casuale generato dal backend e restituito in risposta.
- `count>1` → generazione seriale (seed incrementali), la coda è comunque
  one-shot per richiesta.
- Errori: `400` parametri non validi / `502` backend giù o crash.

### Parametri nativi dei backend

| | Bonsai (FastAPI :8000) | Z-Image (sd-server :8123) |
|---|---|---|
| endpoint | `POST /generate` → PNG binario | `POST /sdapi/v1/txt2img` → `{images:[b64]}` |
| prompt | `prompt` | `prompt` |
| steps | `steps` (default 4) | `steps` (default 8, distilled) |
| cfg | n/d (distilled) | `cfg_scale` (1.0 = effettivo 0) |
| seed | `seed` | `seed` |
| modello | `backend: "bonsai-ternary-gemlite"` | fisso al boot |

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

Pagine:

| Rotta | Contenuto |
|---|---|
| `/` | Home hub: stato backend, card sezioni (Immagini attiva; Testo/Video/3D/RAG/MCP bozze) |
| `/images` | Generatore funzionante (due modelli) + gallery locale + wiki dei due modelli con esempi reali |
| `/text`, `/video`, `/3d`, `/rag`, `/mcp` | Bozze: wiki del tipo di modello + checklist requisiti + stato non installato |

## Script

| Script | Ruolo |
|---|---|
| `scripts/setup.ps1` | one-time: npm install, build frontend, scarica tools/sd-cpp |
| `scripts/copy-models.ps1` | ricopia i pesi da `reference/` in `models/` |
| `scripts/start-bonsai.ps1` | uvicorn :8000 col wrapper corretto |
| `scripts/start-zimage.ps1` | sd-server :8123 |
| `scripts/start-hub.ps1` | node hub/server.mjs :4600 (statici+proxy) |
| `scripts/start-all.ps1` / `stop-all.ps1` | orchestrazione con coda mutex nel hub |

## Decisioni prese

- **Non tocca `reference/`**: è repo altrui, gitignored e volatile; il fix
  del bug bonsai vive nel wrapper di Palamede.
- **Zero dipendenze runtime nel hub** (`node:http`) e **zero dipendenze
  frontend extra** oltre Vite/React: un `npm install` e via.
- **Hash-routing** invece di react-router: 6 pagine, un listener
  `hashchange` basta (YAGNI).
- **La coda è nel hub**, non negli script: il vincolo di esclusività GPU è
  una regola di prodotto, non un'abitudine di avvio.
- I dati della wiki sono **misurati su questa macchina**, non copiati dai
  model card (le cifre ufficiali "sub-second" si intendono su H800).