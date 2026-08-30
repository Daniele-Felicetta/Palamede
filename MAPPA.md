# Palamede — Mappa del progetto

> Mappa di struttura, aggiornabile a mano. Aggiorna questa pagina quando
> aggiungi/rimuovi cartelle o file chiave. Altre fonti di verità:
> `README.md` (uso) e `SPEC.md` (architettura e contratti API).

## Struttura a livello radice

```
Palamede/                      (repo git)
├── backends/     backend Python (FastAPI, un modello alla volta in VRAM)
├── frontend/     UI Vite + React 18 + TypeScript (router hash-based)
├── hub/          server Node.js zero-dipendenze (:4600): statici, proxy, metriche, chat, cronologie
├── knowledge/    llm-wiki (gitignored: raw/ + wiki/)
├── legacy/       flusso .NET storico archiviato (launcher WinForms + bundle)
├── models/       pesi modelli (gitignored; _inutilizzati/ = non referenziati)
├── outputs/      log + cronologie immagini/video (gitignored)
├── reference/    repo/pesi sorgente esterni (gitignored)
├── scripts/      setup / start-* / stop-all / build / watch (PowerShell)
├── src-tauri/    app desktop nativa Tauri v2 (Rust), launcher dei servizi
├── tools/        engine binari: sd-cpp, llama-cpp (gitignored)
├── MAPPA.md      questo file
├── README.md / SPEC.md
├── Palamede.exe  exe Tauri copiato da scripts/build.ps1
├── start.bat / stop.bat
└── palamede_icon.png / palamede_icon.ico
```

## Backend Rust — src-tauri/

- `Cargo.toml` — manifest Rust, Tauri v2, tray-icon, notification, Job Objects Windows.
- `src/main.rs` — avvia/gestisce i servizi locali (uvicorn :8000 + hub :4600) come processi nascosti in un Job Object; comando `notify`; splash; nascondi-in-tray alla chiusura.
- `tauri.conf.json` — productName Palamede v0.19, identifier it.palamede.app, frontendDist ../frontend/dist, bundle NSIS.
- `capabilities/default.json` — permessi finestra main (core + notification).
- `icons/` — icone NSIS/APPX.

## Frontend — frontend/

- `src/main.tsx` — entry React, mappa path→pagina (Home/Images/Chat/Rag/Video/Draft).
- `src/router.ts` — router hash-based (`useHashRoute`).
- `src/store.ts` — store condiviso: poller health/modelli/metriche ogni 3 s, `switchModel`.
- `src/api.ts` — client HTTP verso il hub (tutti gli endpoint `/api/*`).
- `src/desktop.ts` — ponte opzionale verso Tauri (`notify`), no-op in browser.
- `src/data/sections.ts` — fonte delle sezioni/nav (7 route, flag live).
- `src/data/wiki.ts` — contenuti wiki modelli (BONSAI/ZIMAGE/KLEIN/KLEIN9/ORNITH/DRAFTS).
- `src/components/` — Layout (shell+metriche), Markdown (renderer zero-dep), WikiEntry.
- `src/pages/` — Home, Images (4 modelli+img2img+gallery), Chat (streaming SSE Ornith), Rag (kb), Video (Wan 2.1), Draft (3D/MCP).
- `public/` — palamede_icon.png, examples/ (8 immagini committate).
- Config: `package.json`, `vite.config.ts` (proxy /api→:4600), `tsconfig.json`, `index.html`.

## Hub Node.js — hub/

- `server.mjs` — server zero-dipendenze (~640 righe): coda mutex un-modello-alla-volta, metriche (WMI+nvidia-smi), chat via llama-server :8121 (SSE), cronologie immagini/video, statici da frontend/dist.

## Backend Python — backends/

- `modelserver.py` — FastAPI :8000: ModelManager, load/unload (gemlite in-process; sd-server.exe subprocess), /select, /generate, /generate_video.
- `gemlite_loader.py` — monkeypatch low-memory del loader gemlite (fix crash).
- `requirements.txt` — documentativo (il runtime reale usa il venv in reference/).

## Scripts — scripts/

- `setup.ps1` — setup one-time (scarica sd-cpp + llama.cpp, npm build, install backend).
- `start.ps1` / `start-backend.ps1` / `start-hub.ps1` — avvio servizi.
- `stop-all.ps1` — ferma node/sd-server/llama-server/uvicorn.
- `build.ps1` — build completa: frontend + Tauri + copia Palamede.exe in root.
- `watch.ps1` — FileSystemWatcher sui sorgenti → rebuild automatico.
- `copy-models.ps1` — ricopia pesi da reference/ a models/.
- `convert-nvfp4-bf16.py` — dequantizza FLUX.2-klein 9B NVFP4→BF16.

## Legacy (archiviato) — legacy/

- `launcher/PalamedeLauncher.cs` — vecchio launcher WinForms .NET (bundle embedded + runtime.stamp).
- `scripts/build-launcher.ps1` / `build-bundle.ps1` — pipeline di build del launcher .NET (csc.exe).
- `palamede.bundle` / `runtime.stamp` — artefatti del flusso .NET.
- Sostituito da src-tauri (Tauri v2): NIENTE codice attivo dipende da legacy/.

## Cartelle dati (gitignored)

| Cartella | Contenuto |
|---|---|
| `models/` | pesi: bonsai-image-4B, z-image gguf+TE+VAE, wan2.1-1.3b+VAE, klein-9b/4b, ornith 35b/9b. `_inutilizzati/` = animatediff + ltx-2.5 (non referenziati dal codice). |
| `reference/` | repo/pesi sorgente esterni, mai toccati in scrittura. |
| `tools/` | sd-cpp (sd-server.exe, sd-cli.exe), llama-cpp (llama-server.exe). |
| `knowledge/` | llm-wiki: raw/, wiki/, index.md, log.md, SCHEMA.md. |
| `outputs/` | history/ (immagini), videos/, *.log runtime. |

## Regole di manutenzione

1. `models/`, `reference/`, `tools/`, `knowledge/`, `outputs/` sono gitignored: non versionarli.
2. `Palamede.exe` si rigenera con `scripts/build.ps1`; non committarlo.
3. I modelli attivi si ricaricano con `scripts/copy-models.ps1`.
4. Se aggiungi una cartella a livello radice, aggiorna questa mappa.
5. Il flusso di build attivo è SOLO frontend+Tauri (`scripts/build.ps1`); legacy/ non va eseguito.
