// Palamede hub — Osservatorio neurale (backend Python :8131).
//
// Il backend vive in experimental/neural-observatory e parla da solo: avvio,
// stato, addestramento, eventi. L'hub non lo tratta come gli altri modelli —
// non scarica pesi e non tiene un modello in GPU per gli altri — ma gli
// inoltra /api/observatory/* e ne fa il proxy dello stream eventi.
//
// Lo stream è SSE (`text/event-stream`) e non WebSocket: uvicorn nel venv
// dell'osservatorio non ha un'implementazione WebSocket (mancano
// `websockets` e `wsproto`, e la rete di lavoro non permette di installarli).
// `proxyStream` sa già inoltrare risposte chunked per il chat, quindi qui il
// percorso è lo stesso e non serve codice nuovo.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { json, errorJson, proxyJson } from './http.mjs'
import { proxyStream } from './proxy.mjs'
import { spawnLogged, killChild } from './proc.mjs'

const PORT = Number(process.env.PALAMEDE_OBSERVATORY_PORT || 8131)
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`
const CWD = join(ROOT, 'experimental', 'neural-observatory')
const SCRIPT = join(CWD, 'backend', 'server.py')
const PYTHON = join(ROOT, 'reference', 'trellis-venv', 'Scripts', 'python.exe')
const LOG = join(ROOT, 'outputs', 'observatory.log')

const CHILD = { proc: null }

async function up(timeoutMs = 2500) {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}

/** Stato per la UI: il backend risponde? il modello è in GPU? che fase è? */
export async function observatoryStatus() {
  const reachable = await up()
  let state = null
  let error = null
  if (reachable) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      state = r.json ? (await r.json()).state ?? null : null
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  return {
    port: PORT,
    reachable,
    managed: !!(CHILD.proc && !CHILD.proc.killed),
    state,
    error,
    script: existsSync(SCRIPT),
    python: existsSync(PYTHON),
    // il backend vuole un checkpoint in formato Hugging Face, non un GGUF:
    // i pesi devono stare in models/lfm/lfm2.5-230m per essere addestrabili
    checkpoint: existsSync(join(ROOT, 'models', 'lfm', 'lfm2.5-230m', 'config.json')),
  }
}

export async function startObservatory() {
  if (!existsSync(SCRIPT)) throw new Error(`manca ${SCRIPT}`)
  if (!existsSync(PYTHON)) throw new Error(`manca il venv ${PYTHON}`)
  if (await up(800)) return await observatoryStatus()

  const { proc } = spawnLogged({
    exe: PYTHON,
    args: ['-m', 'backend.server'],
    cwd: CWD,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    logFile: LOG,
    header: `\n=== osservatorio avviato $(new Date().toISOString()) ===\n`,
  })
  CHILD.proc = proc
  // l'avvio comprende il caricamento dei pesi e il warmup CUDA: si ascolta il
  // backend, non il fork, e comunque non più di 45 s
  const end = Date.now() + 45000
  while (Date.now() < end) {
    if (proc.exitCode != null) break
    if (await up(1200)) break
    await new Promise((r) => setTimeout(r, 400))
  }
  return await observatoryStatus()
}

export function stopObservatory() {
  if (!CHILD.proc) return false
  killChild(CHILD.proc)
  CHILD.proc = null
  return true
}

/**
 * Instrada /api/observatory/* verso il backend.
 *
 * Tre percorsi: lo stream SSE, i tre comandi di servizio (status/start/stop)
 * e tutto il resto in pass-through (GET via proxyJson, POST letto e
 * reinviato). Gli errori del backend arrivano con il suo status code: un
 * "409 modello non caricato" deve restare un 409, non diventare un 502.
 */
export async function handleObservatory(req, res, rest) {
  const path = rest.replace(/^\/api\/observatory/, '') || '/'

  if (path.startsWith('/api/stream')) {
    return proxyStream(req, res, {
      host: HOST,
      port: PORT,
      path,
      accept: 'text/event-stream',
      defaultType: 'text/event-stream',
      errorMessage:
        'osservatorio non raggiungibile — avvialo dalla pagina Osservatorio (porta 8131)',
    })
  }

  if (path === '/status' || path === '/start' || path === '/stop') {
    if (path === '/start') {
      try {
        return json(res, 200, await startObservatory())
      } catch (e) {
        return errorJson(res, e)
      }
    }
    if (path === '/stop') return json(res, 200, { stopped: stopObservatory() })
    return json(res, 200, await observatoryStatus())
  }

  if (req.method === 'GET') {
    return proxyJson(req, res, path, 30000, BASE)
  }

  let body = ''
  req.on('data', (c) => {
    body += c
  })
  req.on('end', async () => {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body || '{}',
      })
      res.writeHead(r.status, {
        'Content-Type': r.headers.get('content-type') || 'application/json',
      })
      res.end(await r.text())
    } catch (e) {
      const err = new Error(
        `osservatorio non raggiungibile su ${PORT}: ${e instanceof Error ? e.message : e}`,
      )
      err.status = 502
      errorJson(res, err)
    }
  })
}
