// Palamede hub — statici + proxy al modello server unico + metriche di sistema.
//
// Architettura (v2): UN solo backend (backends/modelserver.py, :8000) che
// carica/scarica il modello su POST /select. Il hub resta:
//   - statici frontend/dist
//   - GET  /api/health          stato del modello server
//   - GET  /api/models          stato modelli (cosa è caricato)
//   - POST /api/select          carica/scarica il modello (coda mutex)
//   - POST /api/image           generazione (coda mutex)
//   - GET  /api/metrics         CPU/RAM/GPU (cache, ~2s)
//
// Avvio: node hub/server.mjs   (porta: env PALAMEDE_PORT, default 4600)

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { totalmem, freemem } from 'node:os'

const execFileP = promisify(execFile)

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'frontend', 'dist')
const PORT = Number(process.env.PALAMEDE_PORT || 4600)
const BACKEND = process.env.PALAMEDE_BACKEND || 'http://127.0.0.1:8000'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

// ── coda mutex (un solo modello alla volta sulla GPU) ───────────────────
let chain = Promise.resolve()
function queued(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

async function proxyJson(req, res, targetPath, timeoutMs = 200_000) {
  let body = null
  if (req.method === 'POST') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    body = Buffer.concat(chunks)
  }
  const r = await fetch(BACKEND + targetPath, {
    method: req.method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await r.text()
  res.writeHead(r.status, { 'Content-Type': 'application/json' })
  res.end(text)
}

// ── metriche sistema (ASINCRONE: mai bloccare l'event loop) ──────────────
let metrics = {
  ts: 0, cpu: 0,
  ram: { usedGB: 0, totalGB: 0, pct: 0 },
  gpu: { ok: false, utilPct: 0, vramUsedGB: 0, vramTotalGB: 0, vramPct: 0, tempC: 0, powerW: 0, procs: [] },
}

async function psCpu() {
  try {
    const { stdout } = await execFileP('powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
       '(Get-Counter \'\\Processor(_Total)\\% Processor Time\' -SampleInterval 1 -MaxSamples 1).CounterSamples.CookedValue'],
      { timeout: 5000, windowsHide: true })
    return Math.round(Number(stdout.trim()) * 10) / 10
  } catch {
    return 0
  }
}

async function gpuStats() {
  try {
    const { stdout: smi } = await execFileP('nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
       '--format=csv,noheader,nounits'],
      { timeout: 5000, windowsHide: true })
    const [util, vused, vtot, temp, power] = smi.trim().split(',').map((s) => parseFloat(s.trim()))
    let procs = []
    try {
      const { stdout: pl } = await execFileP('nvidia-smi',
        ['--query-compute-apps=process_name,used_memory', '--format=csv,noheader'],
        { timeout: 5000, windowsHide: true })
      procs = pl.split(/\r?\n/).filter(Boolean).map((line) => {
        const i = line.lastIndexOf(',')
        return { name: line.slice(0, i).trim(), mem: line.slice(i + 1).trim() }
      })
    } catch { /* nessun processo */ }
    const vramUsedGB = vused / 1024, vramTotalGB = vtot / 1024
    return {
      ok: true, utilPct: util, vramUsedGB, vramTotalGB,
      vramPct: vtot ? Math.round((vused / vtot) * 100) : 0,
      tempC: temp, powerW: power, procs,
    }
  } catch {
    return { ok: false, utilPct: 0, vramUsedGB: 0, vramTotalGB: 0, vramPct: 0, tempC: 0, powerW: 0, procs: [] }
  }
}

async function refreshMetrics() {
  try {
    const [cpu, gpu] = await Promise.all([psCpu(), gpuStats()])
    const totalGB = totalmem() / 2 ** 30
    const freeGB = freemem() / 2 ** 30
    metrics = {
      ts: Date.now(), cpu,
      ram: { usedGB: Math.round((totalGB - freeGB) * 10) / 10, totalGB: Math.round(totalGB * 10) / 10, pct: Math.round(((totalGB - freeGB) / totalGB) * 100) },
      gpu,
    }
  } catch (e) {
    console.error('[metrics]', e)
  }
}

setInterval(() => { refreshMetrics().catch(() => {}) }, 2500)
refreshMetrics().catch(() => {})

// ── route /api ───────────────────────────────────────────────────────────
async function handleApi(req, res, path) {
  if (path === '/api/health' && req.method === 'GET') {
    try {
      const r = await fetch(BACKEND + '/models', { signal: AbortSignal.timeout(4000) })
      const j = await r.json()
      return res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: r.ok, current: j.current, zimage_process: j.zimage_process }))
    } catch {
      return res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: false, current: null }))
    }
  }

  if (path === '/api/metrics' && req.method === 'GET') {
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(metrics))
  }

  if (path === '/api/models' && req.method === 'GET') {
    return proxyJson(req, res, '/models', 10_000)
  }

  if (path === '/api/select' && req.method === 'POST') {
    return queued(() => proxyJson(req, res, '/select', 240_000))
  }

  if (path === '/api/image' && req.method === 'POST') {
    return queued(() => proxyJson(req, res, '/generate', 900_000))
  }

  return res.writeHead(404, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ error: { message: 'endpoint inesistente' } }))
}

// ── statici ──────────────────────────────────────────────────────────────
async function serveStatic(res, path) {
  let file = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  if (file === '') file = 'index.html'
  const abs = join(DIST, file)
  if (!abs.startsWith(DIST)) {
    return res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'forbidden' } }))
  }
  try {
    const s = await stat(abs)
    if (s.isDirectory()) throw new Error('dir')
    const data = await readFile(abs)
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
    })
    res.end(data)
  } catch {
    try {
      const idx = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': idx.length })
      res.end(idx)
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'frontend non costruito: npm run build in frontend/' } }))
    }
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
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