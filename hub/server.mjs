// Palamede hub — wiring: statici + router /api + bootstrap.
// La logica vive in hub/lib/* (root/http/guards/queue/proc/metrics/proxy/
// chat/rerank/rag/kb/trellis/chats/stories/lmstudio/gemini/jev/history/docs/
// static/bench/catalog/downloader): qui solo composizione delle route e avvio
// del server. Zero dipendenze (node:http/fetch nativi).
//
// Architettura: UN solo backend (backends/modelserver.py, :8000) che
// carica/scarica il modello su POST /select. Il hub resta:
//   - statici frontend/dist
//   - GET  /api/health          stato del modello server
//   - GET  /api/models          stato modelli (cosa è caricato)
//   - POST /api/select          carica/scarica il modello (coda mutex)
//   - POST /api/image           generazione immagini (coda mutex)
//   - GET  /api/metrics         CPU/RAM/GPU (cache, ~2.5s)
//   - GET  /api/chat/status     stato del server chat (llama-server)
//   - POST /api/chat/start      avvia llama-server con i parametri scelti
//   - POST /api/chat/stop       ferma llama-server
//   - POST /api/chat            chat streaming (SSE pass-through)
//   - GET/POST /api/kb/*        knowledge base RAG (chunk/embed/retrieve/rerank)
//   - GET/POST /api/3d/*        server TRELLIS image-to-3D (:8124) + file generati
//   - GET/POST /api/history*    cronologia immagini persistente
//   - GET/POST /api/chats*      conversazioni chat persistite
//   - GET/POST /api/stories*    archivio partite Bandersketch (testi+tavole)
//   - GET  /api/narrators      narratore cloud disponibile? (chiave in env)
//   - POST /api/narrate        narratore cloud opzionale (Gemini)
//   - GET/POST /api/lmstudio/*  proxy a LM Studio locale (:1234)
//   - GET/POST /api/jev/*       JEV Hub (:4610): progetti experimental
//
// Avvio: node hub/server.mjs   (porta: env PALAMEDE_PORT, default 4600)

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PORT, BACKEND, TRELLIS, ROOT } from './lib/root.mjs'
import { json, proxyJson, proxyBinary, readBody } from './lib/http.mjs'
import { allowedHost, allowedOrigin } from './lib/guards.mjs'
import { createQueue } from './lib/queue.mjs'
import { currentMetrics, startMetrics } from './lib/metrics.mjs'
import { textStatus, startText, stopText, proxyChat } from './lib/chat.mjs'
import { geminiStatus, narrateGemini } from './lib/gemini.mjs'
import { trellisStatus, startTrellis, stopTrellis } from './lib/trellis.mjs'
import { proxyLmStudio } from './lib/lmstudio.mjs'
import { createHistoryRoutes } from './lib/history.mjs'
import { createStoriesRoutes } from './lib/stories.mjs'
import { createKbRoutes } from './lib/kb.mjs'
import { createChatsRoutes } from './lib/chats.mjs'
import { handleDoc } from './lib/docs.mjs'
import { handleBench, handleBenchImages, handleBenchImageFile } from './lib/bench.mjs'
import { downloaderList, availability } from './lib/catalog.mjs'
import { startDownload, downloadStatus, cancelDownload } from './lib/downloader.mjs'
import { handleJev } from './lib/jev.mjs'
import { serveStatic } from './lib/static.mjs'

// ── coda mutex condivisa (un solo modello alla volta sulla GPU) ──────────
const queued = createQueue()
const handleHistory = createHistoryRoutes(queued)
const handleStories = createStoriesRoutes(queued)
const handleKb = createKbRoutes(queued)
const handleChats = createChatsRoutes(queued)

startMetrics()

function valid3dId(id) {
  return /^[a-zA-Z0-9._-]+$/.test(id) && (id.endsWith('.glb') || id.endsWith('.stl'))
}

// ── route /api ───────────────────────────────────────────────────────────
async function handleApi(req, res, path) {
  if (path === '/api/health' && req.method === 'GET') {
    try {
      const r = await fetch(BACKEND + '/models', { signal: AbortSignal.timeout(4000) })
      const j = await r.json()
      return json(res, 200, { ok: r.ok, current: j.current, zimage_process: j.zimage_process })
    } catch {
      return json(res, 200, { ok: false, current: null })
    }
  }

  if (path === '/api/metrics' && req.method === 'GET') {
    return json(res, 200, currentMetrics())
  }

  if (path === '/api/models' && req.method === 'GET') {
    // annota ogni modello col fatto che i file siano presenti (available):
    // il frontend nasconde le card dei modelli non scaricati.
    try {
      const r = await fetch(BACKEND + '/models', { signal: AbortSignal.timeout(10_000) })
      const j = await r.json()
      const av = availability()
      const models = (j.models || []).map((m) => ({ ...m, available: av[m.id] !== false }))
      return json(res, 200, { ...j, models })
    } catch {
      return json(res, 502, { error: { message: 'backend non raggiungibile' } })
    }
  }

  if (path === '/api/select' && req.method === 'POST') {
    return queued(() => proxyJson(req, res, '/select', 240_000, BACKEND))
  }

  if (path === '/api/image' && req.method === 'POST') {
    return queued(() => proxyJson(req, res, '/generate', 900_000, BACKEND))
  }

  // preview in streaming del denoise (PNG del modello attivo; 204 se assente)
  if (path === '/api/preview' && req.method === 'GET') {
    return proxyBinary(res, '/preview', 5_000, BACKEND)
  }

  // ── TRELLIS.2 image-to-3D (venv separato :8124) ────────────────────────
  if (path === '/api/3d/status' && req.method === 'GET') {
    // stato LOCALE del subprocess gestito dal hub (non più proxy): funziona
    // anche quando il server è spento (running:false).
    return json(res, 200, await trellisStatus())
  }

  if (path === '/api/3d/start' && req.method === 'POST') {
    return queued(async () => {
      try {
        const s = await startTrellis()
        // in coda come /chat/start: il frontend vede running:true subito.
        return json(res, 200, s)
      } catch (e) {
        return json(res, 500, { error: { message: e.message } })
      }
    })
  }

  if (path === '/api/3d/stop' && req.method === 'POST') {
    stopTrellis()
    return json(res, 200, await trellisStatus())
  }

  if (path === '/api/3d/generate' && req.method === 'POST') {
    // coda mutex come /api/image; timeout lungo (15 min) per la generazione.
    // NB: il proxy punta al trellis server :8124 (non al modello server :8000).
    if (!(await trellisStatus()).running) {
      return json(res, 409, { error: { message: 'server 3D spento: avvialo dalla sidebar o da /api/3d/start' } })
    }
    return queued(() => proxyJson(req, res, '/generate', 900_000, TRELLIS))
  }

  if (path.startsWith('/api/3d/file/') && req.method === 'GET') {
    // serve un GLB/STL già prodotto da outputs/3d (download / viewer)
    const fm = path.match(/^\/api\/3d\/file\/([^/]+)$/)
    if (fm) {
      const id = fm[1]
      if (!valid3dId(id)) {
        return json(res, 400, { error: { message: 'id non valido' } })
      }
      const dir3d = join(ROOT, 'outputs', '3d')
      const abs = join(dir3d, id)
      if (!abs.startsWith(dir3d)) {
        return json(res, 403, { error: { message: 'forbidden' } })
      }
      try {
        const data = await readFile(abs)
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${id}"`,
        })
        res.end(data)
        return
      } catch {
        return json(res, 404, { error: { message: 'file non trovato' } })
      }
    }
  }

  if (path === '/api/chat/status' && req.method === 'GET') {
    return json(res, 200, textStatus())
  }

  if (path === '/api/chat/start' && req.method === 'POST') {
    return queued(async () => {
      try {
        const body = await readBody(req)
        return json(res, 200, await startText(body))
      } catch (e) {
        return json(res, 500, { error: { message: e.message } })
      }
    })
  }

  if (path === '/api/chat/stop' && req.method === 'POST') {
    stopText()
    return json(res, 200, textStatus())
  }

  if (path === '/api/chat' && req.method === 'POST') {
    return proxyChat(req, res)
  }

  // ── conversazioni chat persistite (outputs/chats) ─────────────────────
  if (path.startsWith('/api/chats')) {
    return handleChats(req, res, path)
  }

  // ── narratori cloud (Gemini via AI Studio, chiave solo server-side) ───
  if (path === '/api/narrators' && req.method === 'GET') {
    return json(res, 200, { gemini: geminiStatus() })
  }

  if (path === '/api/narrate' && req.method === 'POST') {
    return narrateGemini(req, res)
  }

  // ── LM Studio (modelli vision-language, es. unsloth/lfm2.5-vl-3b) ──────
  if (path.startsWith('/api/lmstudio/')) {
    return proxyLmStudio(req, res, path)
  }

  // ── documentazione del progetto (sezione Progetto nella UI) ───────────
  if (path === '/api/doc' && req.method === 'GET') {
    return handleDoc(req, res)
  }

  // ── benchmark dei modelli testuali (sezione Banco nella UI) ───────────
  if (path === '/api/bench' && req.method === 'GET') {
    return handleBench(req, res)
  }

  // ── benchmark dei modelli immagine + immagini generate ────────────────
  if (path === '/api/bench-images' && req.method === 'GET') {
    return handleBenchImages(req, res)
  }
  if (path.startsWith('/api/bench-images/file/') && req.method === 'GET') {
    return handleBenchImageFile(req, res, path)
  }

  // ── downloader modelli (pagina Downloader): catalogo + job di download ─
  if (path === '/api/downloader' && req.method === 'GET') {
    return json(res, 200, downloaderList())
  }
  if (path === '/api/downloader/status' && req.method === 'GET') {
    return json(res, 200, downloadStatus())
  }
  if (path === '/api/downloader/download' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      return json(res, 200, startDownload(body.id))
    } catch (e) {
      return json(res, 409, { error: { message: e.message } })
    }
  }
  if (path === '/api/downloader/cancel' && req.method === 'POST') {
    return json(res, 200, cancelDownload())
  }

  // ── JEV Hub: servizio dedicato che elenca/avvia i progetti jev (:4610) ──
  if (path.startsWith('/api/jev')) {
    return handleJev(req, res, path)
  }

  if (path.startsWith('/api/history')) {
    return handleHistory(req, res, path)
  }

  // ── archivio partite Bandersketch (storie + tavole, diagnostica) ─────
  if (path.startsWith('/api/stories')) {
    return handleStories(req, res, path)
  }

  if (path.startsWith('/api/kb/')) {
    return handleKb(req, res, path)
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
}

createServer(async (req, res) => {
  const start = Date.now()
  // Polling di stato del frontend (LED officina, metriche, chat, 3D) ogni
  // ~3s: risposte da pochi ms, non intasano il log.
  const QUIET = new Set([
    '/api/health', '/api/models', '/api/metrics',
    '/api/chat/status', '/api/3d/status', '/api/preview',
  ])
  const qpath = new URL(req.url, 'http://localhost').pathname
  res.on('finish', () => {
    if (QUIET.has(qpath)) return
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`)
  })
  // richieste interrotte dal client (es. estensione che le blocca a meta'):
  // se /api/metrics appare qui, il browser la INVIA ma la interrompe.
  req.on('aborted', () => {
    console.log(`[${new Date().toISOString()}] ABORTED ${req.method} ${req.url} (${Date.now() - start}ms)`)
  })
  const path = new URL(req.url, 'http://localhost').pathname
  // ── anti drive-by / DNS rebinding ──
  if (!allowedHost(req)) return json(res, 403, { error: { message: 'host non ammesso' } })
  if (path.startsWith('/api/') && !allowedOrigin(req, PORT)) return json(res, 403, { error: { message: 'origin non ammessa' } })
  try {
    if (path.startsWith('/api/')) return await handleApi(req, res, path)
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(res, path)
    res.writeHead(405, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: { message: 'metodo non ammesso' } }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: { message: e.message } }))
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Palamede hub su http://127.0.0.1:${PORT}`)
  console.log(`  modello server → ${BACKEND} (un solo modello caricato alla volta)`)
})

// Non morire per un errore sporadico: logga e continua.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e))
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))
