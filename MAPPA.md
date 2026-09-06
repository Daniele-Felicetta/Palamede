# Palamede — Mappa del progetto

> Mappa di struttura dell'officina. L'albero qui sotto è **auto-generato** da
> `.\scripts\gen-mappa.ps1` (rispetta `.gitignore`); le sezioni descrittive
> si aggiornano a mano. Altre fonti di verità: `README.md` (uso),
> `SPEC.md` (architettura e contratti API) e `SECURITY.md` (sicurezza).

## Struttura a livello radice

> `(gitignored)` = non versionato. Dopo aver aggiunto/rimosso cartelle o file
> alla radice esegui: `.\scripts\gen-mappa.ps1`.

<!-- GEN:ALBERO -->
```text
Palamede/                       (repo git · aggiornata: 2026-09-02 02:05)
├── backends/
├── experimental/
├── frontend/
├── hub/
├── knowledge/   (gitignored)
├── legacy/
├── models/   (gitignored)
├── outputs/   (gitignored)
├── reference/   (gitignored)
├── scripts/
├── src-tauri/
├── tools/   (gitignored)
├── .editorconfig
├── .gitignore
├── MAPPA.md
├── Palamede.exe   (gitignored)
├── palamede_icon.ico   (gitignored)
├── palamede_icon.png
├── README.md
├── SECURITY.md
├── SPEC.md
├── start.bat
└── stop.bat
```
<!-- /GEN:ALBERO -->

## Backend Rust — src-tauri/

- `Cargo.toml` — manifest Rust, Tauri v2, tray-icon, notification, Job Objects Windows.
- `src/main.rs` — avvia/gestisce i servizi locali (uvicorn :8000 + hub :4600) come processi nascosti in un Job Object; comando `notify`; splash; nascondi-in-tray alla chiusura.
- `tauri.conf.json` — productName Palamede v0.19, identifier it.palamede.app, frontendDist ../frontend/dist, bundle NSIS.
- `capabilities/default.json` — permessi finestra main (core + notification).
- `icons/` — icone NSIS/APPX.

## Frontend — frontend/

- `src/main.ts` — entry Svelte 5, monta `App.svelte` (auto-routing da `pages/*.svelte`).
- `src/App.svelte` — mappa path→pagina (Home/Images/Chat/Rag/Progetto/3d…) + Draft per le bozze.
- `src/router.svelte.ts` — router hash-based (`route` $state + `navigate()`).
- `src/store.svelte.ts` — store condiviso: poller health/modelli/metriche/chat ogni 3 s (no overlap, pausa a scheda nascosta), `switchModel`.
- `src/api.ts` — client HTTP verso il hub (tutti gli endpoint `/api/*`: health, models, image, history, chat, kb, 3d, doc).
- `src/lib/images.ts` + `src/lib/text.ts` — logica di dominio pura (preset formati/step, parse formati con snap a multipli di 32, parser SSE).
- `src/desktop.ts` — ponte opzionale verso Tauri (`notify`), no-op in browser.
- `src/data/sections.ts` — fonte delle sezioni/nav (8 route, flag live).
- `src/data/wiki.ts` — contenuti wiki modelli (BONSAI/ZIMAGE/KLEIN/ORNITH/DRAFTS).
- `src/components/` — Layout (shell+metriche), Markdown (renderer zero-dep con escaping + allowlist http/https), WikiEntry, Shot, ReasonBlock, Draft + `ui/` (design system).
- `src/pages/` — Home, Images (3 modelli+img2img+gallery), Chat (streaming SSE Ornith + knowledge), Rag (kb llm-wiki), 3d (viewer three.js + GLB/STL), Games, Experimental, Progetto.
- `public/` — palamede_icon.png, examples/ (8 immagini committate).
- Config: `package.json` (svelte 5 + three), `vite.config.ts` (proxy /api→:4600, three in chunk a parte), `tsconfig.json` (esclude `src/ui/` e `src/components/ui2/`: duplicati non usati, rotti — la UI viva è `src/components/ui/`), `svelte.config.js`, `index.html`.

## Hub Node.js — hub/

- `server.mjs` — server zero-dipendenze (~655 righe): coda mutex un-modello-alla-volta, metriche (WMI+nvidia-smi), chat via llama-server :8121 (SSE), doc progetto (/api/doc), cronologie immagini, statici da frontend/dist.

## Backend Python — backends/

- `modelserver.py` — FastAPI :8000: ModelManager, load/unload (gemlite in-process; sd-server.exe subprocess), /select, /generate.
- `gemlite_loader.py` — monkeypatch low-memory del loader gemlite (fix crash).
- `trellis_server.py` — FastAPI :8124: pipeline TRELLIS.2 image-to-3D (venv separato `reference/trellis-venv`, Python 3.13 + torch CUDA nativo). Genera mesh texturizzata → GLB (o_voxel) + STL (trimesh, solo geometria); serializza le generazioni con un lock; servita dal hub (`/api/3d/start|stop|status|generate|file/<id>.{glb,stl}`).
- `requirements.txt` — documentativo (il runtime reale usa il venv in reference/).

## Scripts — scripts/

- `setup.ps1` — setup one-time (scarica sd-cpp + llama.cpp, npm build, install backend).
- `start.ps1` / `start-backend.ps1` / `start-hub.ps1` — avvio servizi.
- `stop-all.ps1` — ferma node/sd-server/llama-server/uvicorn.
- `build.ps1` — build completa: frontend + Tauri + copia Palamede.exe in root.
- `watch.ps1` — FileSystemWatcher sui sorgenti → rebuild automatico.
- `copy-models.ps1` — ricopia pesi da reference/ a models/.
- `convert-nvfp4-bf16.py` — dequantizza FLUX.2-klein 9B NVFP4→BF16 (in bozza con klein-9b).
- `setup-trellis.ps1` — one-time TRELLIS: deps pip + native da sorgente (flex_gemm, cumesh, o_voxel, nvdiffrast) + decoder Stage1 (RMBG2 per il background). Popola `reference/trellis-venv`.
- `start-trellis.ps1` — avvia il server 3D TRELLIS (:8124, venv separato); gestito anche dal hub (`/api/3d/start`).

## Legacy (archiviato) — legacy/

- `launcher/PalamedeLauncher.cs` — vecchio launcher WinForms .NET (bundle embedded + runtime.stamp).
- `scripts/build-launcher.ps1` / `build-bundle.ps1` — pipeline di build del launcher .NET (csc.exe).
- `palamede.bundle` / `runtime.stamp` — artefatti del flusso .NET.
- Sostituito da src-tauri (Tauri v2): NIENTE codice attivo dipende da legacy/.

## Cartelle dati (gitignored)

| Cartella | Contenuto |
|---|---|
| `models/` | pesi: bonsai-image-4B, z-image gguf+TE+VAE, klein-4b, ornith 35b/9b. `_inutilizzati/` = animatediff + ltx-2.5 + wan2.1 (VAE incluso) + klein-9b (sospesi, non referenziati dal codice). `trellis-deps/` = dinov3 (DINOv3 ViT, Meta AI, feature extraction) + rmbg2 (BRIA RMBG-2.0 / BiRefNet, rimozione sfondo), dipendenze di visione locali non referenziate dal codice. `TRELLIS.2/` = codice sorgente del progetto TRELLIS.2 di Microsoft (~37,5 MB, 2201 file, licenza MIT; pipeline image-to-3D + texturing) — **integrato** via `backends/trellis_server.py` (patch per backend `sdpa` e fix transformers 5.16). `TRELLIS.2-4B/` = pesi ufficiali 4B in safetensors (~15,12 GB, 22 file) per la generazione 3D da immagine — **integrati** (backend TRELLIS operativo). |
| `reference/` | repo/pesi sorgente esterni, mai toccati in scrittura. |
| `tools/` | sd-cpp (sd-server.exe, sd-cli.exe), llama-cpp (llama-server.exe). |
| `knowledge/` | llm-wiki: raw/, wiki/, index.md, log.md, SCHEMA.md. |
| `outputs/` | history/ (immagini), videos/, *.log runtime. |

## Convenzioni

- Nomi in **minuscolo senza spazi**; underscore per raggruppamenti di
  comodo (`_inutilizzati/`).
- Sorgenti per area: `src-tauri/` (Rust), `frontend/` (UI), `hub/` (server
  Node), `backends/` (Python), `scripts/` (PowerShell).
- Gitignored = dati e artefatti rigenerabili o esterni (`models/`,
  `reference/`, `tools/`, `knowledge/`, `outputs/`, `*.exe`, bundle).
- L'albero si aggiorna con `.\scripts\gen-mappa.ps1`; le sezioni descrittive
  e la tabella dati si aggiornano a mano.

## Regole di manutenzione

1. `models/`, `reference/`, `tools/`, `knowledge/`, `outputs/` sono gitignored: non versionarli.
2. `Palamede.exe` si rigenera con `scripts/build.ps1`; non committarlo.
3. I modelli attivi si ricaricano con `scripts/copy-models.ps1`.
4. Dopo ogni cambio a livello radice (nuova cartella/file): `.\scripts\gen-mappa.ps1`.
5. Il flusso di build attivo è SOLO frontend+Tauri (`scripts/build.ps1`); legacy/ non va eseguito.
6. La pagina Progetto nell'app mostra `MAPPA.md`, `README.md`, `SPEC.md`,
   `SECURITY.md` (endpoint hub `/api/doc`): i quattro file devono restare
   alla radice.
7. Scaricare/installare pacchetti o file **SOLO da fonti ufficiali** (repo
   ufficiali Microsoft/JeffreyXiang per TRELLIS, PyPI, canale PyTorch
   ufficiale, download ufficiali): MAI utenti terzi su HuggingFace/GitHub né
   wheel precompilati da repo non ufficiali. Per le dipendenze native di
   TRELLIS.2 (`o_voxel`, `flex_gemm`, `cumesh`) la via è la compilazione da
   sorgente dai repo ufficiali, senza wheel di terze parti.
