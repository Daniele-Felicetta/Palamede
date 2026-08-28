// Palamede hub — statici + proxy al modello server unico + metriche di sistema
// + chat locale (llama.cpp llama-server, start/stop/stream da /api/chat).
//
// Architettura (v2): UN solo backend (backends/modelserver.py, :8000) che
// carica/scarica il modello su POST /select. Il hub resta:
//   - statici frontend/dist
//   - GET  /api/health          stato del modello server
//   - GET  /api/models          stato modelli (cosa è caricato)
//   - POST /api/select          carica/scarica il modello (coda mutex)
//   - POST /api/image           generazione (coda mutex)
//   - GET  /api/metrics         CPU/RAM/GPU (cache, ~2s)
//   - GET  /api/chat/status     stato del server chat (llama-server)
//   - POST /api/chat/start      avvia llama-server con i parametri scelti
//   - POST /api/chat/stop       ferma llama-server
//   - POST /api/chat            chat streaming (SSE pass-through)
//
// Avvio: node hub/server.mjs   (porta: env PALAMEDE_PORT, default 4600)

import { createServer, request as httpRequest } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
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

// Le risposte /api sono sempre fresche: mai in cache (niente metriche o
// stati modello stantii nel browser).
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
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
  json(res, r.status, safeJson(text))
}

// Il body pass-through è già JSON: se per qualche motivo non lo fosse, non
// rompiamo la risposta con un JSON.stringify di un testo non-json.
function safeJson(text) {
  try { return JSON.parse(text) } catch { return { raw: text } }
}

// ── metriche sistema (ASINCRONE: mai bloccare l'event loop) ──────────────
let metrics = {
  ts: 0, cpu: 0,
  ram: { usedGB: 0, totalGB: 0, pct: 0 },
  gpu: { ok: false, utilPct: 0, vramUsedGB: 0, vramTotalGB: 0, vramPct: 0, tempC: 0, powerW: 0, procs: [] },
}

function num(s) {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : 0
}

// CPU: Win32_Processor.LoadPercentage è rapido e non richiede il counter
// lento di Get-Counter (~1s a chiamata). Se esce 0 (spesso a riposo) usa
// l'ultimo valore noto per non avere strani "buchi" nella sidebar.
let lastCpu = 0
async function psCpu() {
  try {
    const { stdout } = await execFileP('powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
       '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'],
      { timeout: 5000, windowsHide: true })
    const v = num(stdout)
    if (v > 0) lastCpu = v
    return Math.round((v > 0 ? v : lastCpu) * 10) / 10
  } catch {
    return lastCpu
  }
}

// Ultimo sample GPU valido: se nvidia-smi va in timeout (sotto carico) o
// fallisce, continuiamo a servire l'ultimo valore invece di far comparire
// "nvidia-smi non disponibile" a ogni refresh.
let lastGoodGpu = null

async function gpuStats() {
  try {
    const { stdout: smi } = await execFileP('nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
       '--format=csv,noheader,nounits'],
      { timeout: 10000, windowsHide: true })
    const [util, vused, vtot, temp, power] = smi.trim().split(',').map(num)
    let procs = []
    try {
      const { stdout: pl } = await execFileP('nvidia-smi',
        ['--query-compute-apps=process_name,used_memory', '--format=csv,noheader'],
        { timeout: 10000, windowsHide: true })
      // i processi senza memoria riportata (desktop compositing, [N/A]) si
      // mostrano comunque con '?': la lista dice "la GPU è viva".
      const interesting = /llama|python|sd-server|node|LM Studio|uv|Palamede/i
      procs = pl.split(/\r?\n/)
        .filter((line) => line && line.includes(','))
        .map((line) => {
          const i = line.lastIndexOf(',')
          const name = line.slice(0, i).trim()
          let mem = line.slice(i + 1).trim()
          if (mem.includes('[N/A]') || mem === '') mem = '?'
          return { name, mem, hot: interesting.test(name) }
        })
        .sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0))
        .slice(0, 8)
        .map(({ name, mem }) => ({ name, mem }))
    } catch { /* nessun processo */ }
    const vramUsedGB = vused / 1024, vramTotalGB = vtot / 1024
    lastGoodGpu = {
      ok: vtot > 0, utilPct: util, vramUsedGB, vramTotalGB,
      vramPct: vtot ? Math.round((vused / vtot) * 100) : 0,
      tempC: temp, powerW: power, procs,
    }
    return lastGoodGpu
  } catch {
    // sample fallito: se prima è andato, serviamo lo stale (mai "non disponibile")
    if (lastGoodGpu) return { ...lastGoodGpu }
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

// ── chat locale (llama.cpp llama-server) ─────────────────────────────────
const LLAMA = join(ROOT, 'tools', 'llama-cpp', 'llama-server.exe')
const TEXT_PORT = Number(process.env.PALAMEDE_TEXT_PORT || 8121)
const TEXT_LOG = join(ROOT, 'outputs', 'text-server.log')

const TEXT_MODELS = [
  { id: 'ornith-35b', name: 'Ornith 1.5 35B-A3B · Q4_K_M', moe: true,
    file: join(ROOT, 'models', 'ornith-1.5-35b', 'Ornith-1.5-35B-Q4_K_M.gguf') },
  { id: 'ornith-9b', name: 'Ornith 1.5 9B · Q4_K_M', moe: false,
    file: join(ROOT, 'models', 'ornith-1.5-9b', 'Ornith-1.5-9B-Q4_K_M.gguf') },
  { id: 'ornith-9b-q5', name: 'Ornith 1.5 9B · Q5_K_M', moe: false,
    file: join(ROOT, 'models', 'ornith-1.5-9b', 'Ornith-1.5-9B-Q5_K_M.gguf') },
].filter((m) => existsSync(m.file))

let textServer = { proc: null, model: null, params: null }

async function textReady(timeoutMs = 3000) {
  try {
    const r = await fetch(`http://127.0.0.1:${TEXT_PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return (await r.json()).status === 'ok'
  } catch { /* giù */ }
  return false
}

function textStatus() {
  return {
    running: !!(textServer.proc && !textServer.proc.killed),
    ready: !!textServer.ready,
    model: textServer.model,
    params: textServer.params,
    pid: textServer.proc ? textServer.proc.pid : null,
    models: TEXT_MODELS.map((m) => ({ id: m.id, name: m.name, moe: m.moe, file: m.file })),
  }
}

function stopText(force = true) {
  if (textServer.proc) {
    try { textServer.proc.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* già morto */ }
    textServer.proc = null
  }
  textServer.model = null
  textServer.params = null
  textServer.ready = false
}

async function startText(cfg) {
  if (textServer.proc) stopText(true)
  const model = TEXT_MODELS.find((m) => m.id === cfg.model)
  if (!model) throw new Error(`modello chat sconosciuto: ${cfg.model}`)
  const context = Math.min(65536, Math.max(1024, Number(cfg.context) || 8192))
  const kv = cfg.kv === 'f16' ? null : (['q8_0', 'q4_0', 'q5_0', 'iq4_nl'].includes(cfg.kv) ? cfg.kv : 'q8_0')
  const gpuLayers = Math.max(-1, Number(cfg.gpuLayers) ?? 99)
  const cpuMoe = Math.max(0, Number(cfg.cpuMoe) || 0)
  const mtp = !!cfg.mtp

  const args = [
    '-m', model.file,
    '--host', '127.0.0.1', '--port', String(TEXT_PORT),
    '-c', String(context),
    '-ngl', String(gpuLayers),
    '--flash-attn', 'on',
    '--no-warmup',
  ]
  if (kv) args.push('--cache-type-k', kv, '--cache-type-v', kv)
  if (model.moe && cpuMoe > 0) args.push('--n-cpu-moe', String(cpuMoe))
  if (mtp) args.push('--spec-type', 'draft-mtp')

  if (!existsSync(LLAMA)) throw new Error(`manca ${LLAMA} — esegui scripts/setup.ps1`)
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })

  textServer.model = model.id
  textServer.params = { context, kv: kv || 'f16', mtp, cpuMoe, gpuLayers }
  textServer.ready = false
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })
  const logFd = openSync(TEXT_LOG, 'a')
  try {
    writeSync(logFd, `\n--- avvio ${model.id} ctx=${context} kv=${kv || 'f16'} mtp=${mtp} cpuMoe=${cpuMoe} ngl=${gpuLayers} ---\n`)
  } catch { /* log best-effort */ }
  textServer.proc = spawn(LLAMA, args, {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', logFd, logFd],
  })
  textServer.proc.on('error', (e) => { try { writeSync(logFd, 'errore spawn: ' + e.message + '\n') } catch { /* log chiuso */ } })
  textServer.proc.on('exit', () => {
    textServer.proc = null
    textServer.ready = false
  })

  // attesa readiness (i modelli grossi caricano in 10–60s)
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    if (!textServer.proc) throw new Error('llama-server è uscito durante l\'avvio (vedi outputs/text-server.log)')
    if (await textReady(2000)) {
      textServer.ready = true
      return textStatus()
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('llama-server non pronto entro 150s (vedi outputs/text-server.log)')
}

// proxy SSE: la risposta di llama-server viene passata byte per byte
function proxyChat(req, res) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const preq = httpRequest({
      host: '127.0.0.1', port: TEXT_PORT, path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Accept: 'text/event-stream',
      },
    }, (pres) => {
      res.writeHead(pres.statusCode || 200, {
        'Content-Type': pres.headers['content-type'] || 'text/event-stream',
        'Cache-Control': 'no-store',
      })
      pres.pipe(res)
    })
    preq.on('error', (e) => {
      if (!res.headersSent) {
        json(res, 502, { error: { message: `llama-server non raggiungibile: ${e.message}` } })
      } else {
        res.end()
      }
    })
    preq.end(body)
  })
  req.on('error', () => res.end())
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
    return json(res, 200, metrics)
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
    stopText(true)
    return json(res, 200, textStatus())
  }

  if (path === '/api/chat' && req.method === 'POST') {
    return proxyChat(req, res)
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  // strip BOM UTF-8 e spazi: JSON.parse non li tollera
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim()
  try { return JSON.parse(text) } catch { return {} }
}

// ── statici ──────────────────────────────────────────────────────────────
async function serveStatic(res, path) {
  let file = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  if (file === '') file = 'index.html'
  const isHtml = extname(file).toLowerCase() === '.html'
  const abs = join(DIST, file)
  if (!abs.startsWith(DIST)) {
    return json(res, 403, { error: { message: 'forbidden' } })
  }
  try {
    const s = await stat(abs)
    if (s.isDirectory()) throw new Error('dir')
    const data = await readFile(abs)
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      // index.html mai in cache: punta a bundle con hash, la shell va rivista
      ...(isHtml ? { 'Cache-Control': 'no-cache' } : {}),
    })
    res.end(data)
  } catch {
    try {
      const idx = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Length': idx.length,
        'Cache-Control': 'no-cache',
      })
      res.end(idx)
    } catch {
      json(res, 404, { error: { message: 'frontend non costruito: npm run build in frontend/' } })
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