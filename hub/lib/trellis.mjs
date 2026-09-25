// Palamede hub — server 3D TRELLIS.2 (image-to-3D, venv separato :8124).
// La pipeline carica in modo lazy: /status risponde 200 non appena il processo
// è vivo, mentre ready=true si attiva dopo il primo caricamento. Per la
// "readiness" del processo basta quindi che /status risponda.

import { existsSync } from 'node:fs'
import { ROOT, TRELLIS_PORT, TRELLIS_PY, TRELLIS_LOG } from './root.mjs'
import { spawnLogged, killChild } from './proc.mjs'

// Server 3D come subprocess gestito dal hub (start/stop), analogo a
// textServer per la chat. Il venv Python è separato e carica la pipeline in
// modo lazy: ready=true si attiva solo dopo il primo caricamento.
let trellisServer = { proc: null, ready: false, load_time_s: null }

async function trellisReady(timeoutMs = 3000) {
  try {
    const r = await fetch(`http://127.0.0.1:${TRELLIS_PORT}/status`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return true
  } catch { /* giù */ }
  return false
}

export async function trellisStatus() {
  const running = !!(trellisServer.proc && !trellisServer.proc.killed)
  // se vivo, leggiamo lo stato reale del backend (:8124/status) e aggiorniamo
  // la cache; se il fetch fallisce usiamo la cache. Così /api/3d/status non è
  // mai "stale": ready/loading riflettono il vero stato del server trellis.
  let load_time_s = trellisServer.load_time_s
  let ready = trellisServer.ready
  let loading = false
  if (running) {
    try {
      const r = await fetch(`http://127.0.0.1:${TRELLIS_PORT}/status`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const j = await r.json()
        if (typeof j.load_time_s === 'number') { trellisServer.load_time_s = j.load_time_s; load_time_s = j.load_time_s }
        if (j.ready === true) { trellisServer.ready = true; ready = true }
        loading = j.loading === true
      }
    } catch { /* giù: usa la cache */ }
  }
  return { running, ready, loading, pid: trellisServer.proc ? trellisServer.proc.pid : null, load_time_s }
}

export function stopTrellis() {
  killChild(trellisServer.proc)
  trellisServer.proc = null
  trellisServer.ready = false
  trellisServer.load_time_s = null
}

export async function startTrellis() {
  if (trellisServer.proc && !trellisServer.proc.killed) return await trellisStatus()

  if (!existsSync(TRELLIS_PY)) throw new Error(`manca ${TRELLIS_PY} — il venv TRELLIS non esiste`)

  trellisServer.ready = false
  trellisServer.load_time_s = null
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ATTN_BACKEND: 'sdpa',
  }
  // python -m uvicorn backends.trellis_server:app --port <porta>
  const { proc } = spawnLogged({
    exe: TRELLIS_PY,
    args: ['-m', 'uvicorn', 'backends.trellis_server:app', '--port', String(TRELLIS_PORT)],
    cwd: ROOT, env, logFile: TRELLIS_LOG,
    header: `\n--- avvio trellis server su porta ${TRELLIS_PORT} ---\n`,
  })
  trellisServer.proc = proc
  proc.on('exit', () => {
    // Solo se e' ancora il processo corrente: alla riapertura l'exit del
    // vecchio processo arriva dopo lo spawn del nuovo e non deve azzerarlo.
    if (trellisServer.proc === proc) {
      trellisServer.proc = null
      trellisServer.ready = false
      trellisServer.load_time_s = null
    }
  })

  // attesa che /status risponda (il server uvicorn parte in pochi secondi)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (!trellisServer.proc) throw new Error('il server 3D è uscito durante l\'avvio (vedi outputs/trellis-server.log)')
    if (await trellisReady(2000)) return await trellisStatus()
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('server 3D non pronto entro 60s (vedi outputs/trellis-server.log)')
}
