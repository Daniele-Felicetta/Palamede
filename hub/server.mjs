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
//   - GET/POST /api/kb/*        knowledge base llm-wiki (status/files/read/save/delete/search/ingest/embeddings)
//   - POST /api/3d/start|stop   server TRELLIS image-to-3D (:8124)
//   - POST /api/3d/generate     generazione 3D (coda mutex)
//   - GET  /api/history*        cronologia immagini persistente
//
// Avvio: node hub/server.mjs   (porta: env PALAMEDE_PORT, default 4600)

import { createServer, request as httpRequest } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, openSync, writeSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { totalmem, freemem } from 'node:os'

const execFileP = promisify(execFile)

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'frontend', 'dist')
const PORT = Number(process.env.PALAMEDE_PORT || 4600)
const BACKEND = process.env.PALAMEDE_BACKEND || 'http://127.0.0.1:8000'
// TRELLIS.2 (image-to-3D): venv separato su :8124, porta lunga (generazione ~74s)
const TRELLIS = process.env.PALAMEDE_TRELLIS || 'http://127.0.0.1:8124'
// LM Studio (OpenAI-compatible :1234): modelli vision-language per le storie
const LMSTUDIO = process.env.PALAMEDE_LMSTUDIO || 'http://127.0.0.1:1234'

// Server 3D TRELLIS come subprocess gestito dal hub (start/stop), analogo a
// textServer per la chat. Il venv Python è separato e carica la pipeline in
// modo lazy: /status risponde 200 non appena il processo è vivo, mentre
// j.ready=true si attiva solo dopo il primo caricamento del modello.
const TRELLIS_PORT = Number(process.env.PALAMEDE_TRELLIS_PORT || 8124)
const TRELLIS_PY = join(ROOT, 'reference', 'trellis-venv', 'Scripts', 'python.exe')
const TRELLIS_LOG = join(ROOT, 'outputs', 'trellis-server.log')
let trellisServer = { proc: null, ready: false, load_time_s: null }

// documenti serviti alla sezione Progetto della UI (whitelist: niente path traversal)
const DOC_FILES = { mappa: 'MAPPA.md', readme: 'README.md', spec: 'SPEC.md', security: 'SECURITY.md' }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.stl': 'model/stl',
  '.webmanifest': 'application/manifest+json',
}

// ── anti drive-by / DNS rebinding ─────────────────────────────────────────
// I servizi ascoltano su 127.0.0.1 ma senza autenticazione: senza queste
// due difese una pagina web malevola aperta nel browser dell'utente può
// chiamare le API (le POST "simple" non fanno preflight CORS).
//   1. allowedHost  — il browser invia SEMPRE l'Host richiesto: se non è
//      loopback la richiesta arriva da un dominio malevolo risolto su
//      127.0.0.1 (DNS rebinding). 403.
//   2. allowedOrigin — il browser invia l'Origin su tutte le fetch e su
//      tutte le POST: se non è l'hub (o il dev server Vite) è una richiesta
//      cross-origin da un sito web. 403.
// I client non-browser (curl, PowerShell, Rust) non inviano Origin e
// restano ammessi: sono processi locali già privilegiati, fuori dal modello
// di minaccia. Residuo documentato in SECURITY.md: probing GET in sola
// lettura via <img>/<script> su URL con id non indovinabili.
const DEV_ORIGIN_PORT = 5173 // dev server Vite (frontend/vite.config.ts)

function allowedHost(req) {
  let h = String(req.headers.host || '').toLowerCase()
  if (h.startsWith('[')) { // IPv6 "[::1]:port"
    const m = h.match(/^\[([^\]]+)\]/)
    h = m ? m[1] : h
  } else {
    const i = h.lastIndexOf(':')
    if (i > 0) h = h.slice(0, i)
  }
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || '').toLowerCase()
  if (!origin) return true
  const ok = new Set([
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${DEV_ORIGIN_PORT}`,
    `http://localhost:${DEV_ORIGIN_PORT}`,
  ])
  return ok.has(origin)
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

async function proxyJson(req, res, targetPath, timeoutMs = 200_000, base = BACKEND) {
  let body = null
  if (req.method === 'POST') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    body = Buffer.concat(chunks)
  }
  try {
    const r = await fetch(base + targetPath, {
      method: req.method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await r.text()
    json(res, r.status, safeJson(text))
  } catch (e) {
    json(res, 502, { error: { message: `backend non raggiungibile (${e.message || e})` } })
  }
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
    file: join(ROOT, 'models', 'ornith-1.5-35b', 'Ornith-1.5-35B-Q4_K_M.gguf'),
    mmproj: join(ROOT, 'models', 'ornith-1.5-35b', 'mmproj-Ornith-1.5-35B-BF16.gguf') },
  { id: 'ornith-9b', name: 'Ornith 1.5 9B · Q4_K_M', moe: false,
    file: join(ROOT, 'models', 'ornith-1.5-9b', 'Ornith-1.5-9B-Q4_K_M.gguf'),
    mmproj: join(ROOT, 'models', 'ornith-1.5-9b', 'mmproj-Ornith-1.5-9B-BF16.gguf') },
  { id: 'ornith-9b-q5', name: 'Ornith 1.5 9B · Q5_K_M', moe: false,
    file: join(ROOT, 'models', 'ornith-1.5-9b', 'Ornith-1.5-9B-Q5_K_M.gguf') },
  { id: 'bonsai-27b', name: 'Bonsai 27B · Q1_0', moe: false,
    file: join(ROOT, 'models', 'bonsai-27b', 'Bonsai-27B-Q1_0.gguf') },
  // LFM2.5 VL 3B: vision-language (mmproj) per Bandersketch e chat multimodale.
  { id: 'lfm-vl-3b', name: 'LFM2.5 VL 3B · Q5_K_XL', moe: false,
    file: join(ROOT, 'models', 'lfm-vl-3b', 'LFM2.5-VL-3B-Q5_K_XL.gguf'),
    mmproj: join(ROOT, 'models', 'lfm-vl-3b', 'mmproj-LFM2.5-VL-3B-F32.gguf') },
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
  // cpuMoe: 0 = tutto su GPU, N>0 = primi N layer di esperti su RAM,
  // -1 = tutti gli esperti su RAM (coesistenza con i modelli immagine).
  const cpuMoe = Number.isFinite(Number(cfg.cpuMoe)) ? Math.max(-1, Number(cfg.cpuMoe)) : 0
  const mtp = !!cfg.mtp
  const thinking = cfg.thinking === true

  const args = [
    '-m', model.file,
    '--host', '127.0.0.1', '--port', String(TEXT_PORT),
    '-c', String(context),
    '-ngl', String(gpuLayers),
    '--flash-attn', 'on',
    '--no-warmup',
  ]
  if (kv) args.push('--cache-type-k', kv, '--cache-type-v', kv)
  if (model.mmproj && existsSync(model.mmproj)) args.push('--mmproj', model.mmproj)
  // MoE su CPU: cpuMoe > 0 = primi N layer di esperti su RAM, cpuMoe === -1 =
  // tutti gli esperti su RAM (libera la VRAM per i modelli immagine).
  if (model.moe && cpuMoe === -1) args.push('--cpu-moe')
  else if (model.moe && cpuMoe > 0) args.push('--n-cpu-moe', String(cpuMoe))
  if (mtp) args.push('--spec-type', 'draft-mtp')
  args.push('--reasoning', thinking ? 'on' : 'off')

  if (!existsSync(LLAMA)) throw new Error(`manca ${LLAMA} — esegui scripts/setup.ps1`)
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })

  textServer.model = model.id
  textServer.params = { context, kv: kv || 'f16', mtp, cpuMoe, gpuLayers, thinking }
  textServer.ready = false
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })
  const logFd = openSync(TEXT_LOG, 'a')
  try {
    writeSync(logFd, `\n--- avvio ${model.id} ctx=${context} kv=${kv || 'f16'} mtp=${mtp} cpuMoe=${cpuMoe} ngl=${gpuLayers} think=${thinking ? 'on' : 'off'} ---\n`)
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

// ── server 3D TRELLIS.2 (image-to-3D, venv separato :8124) ──────────────────
// La pipeline carica in modo lazy: /status risponde 200 non appena il processo
// è vivo, mentre j.ready=true si attiva dopo il primo caricamento. Per la
// "readiness" del processo basta quindi che /status risponda.

async function trellisReady(timeoutMs = 3000) {
  try {
    const r = await fetch(`http://127.0.0.1:${TRELLIS_PORT}/status`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return true
  } catch { /* giù */ }
  return false
}

async function trellisStatus() {
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

function stopTrellis(force = true) {
  if (trellisServer.proc) {
    try { trellisServer.proc.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* già morto */ }
    trellisServer.proc = null
  }
  trellisServer.ready = false
  trellisServer.load_time_s = null
}

async function startTrellis() {
  if (trellisServer.proc && !trellisServer.proc.killed) return await trellisStatus()

  if (!existsSync(TRELLIS_PY)) throw new Error(`manca ${TRELLIS_PY} — il venv TRELLIS non esiste`)
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })

  const logFd = openSync(TRELLIS_LOG, 'a')
  try { writeSync(logFd, `\n--- avvio trellis server su porta ${TRELLIS_PORT} ---\n`) } catch { /* log best-effort */ }

  trellisServer.ready = false
  trellisServer.load_time_s = null
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ATTN_BACKEND: 'sdpa',
  }
  // python -m uvicorn backends.trellis_server:app --port <porta>
  const args = ['-m', 'uvicorn', 'backends.trellis_server:app', '--port', String(TRELLIS_PORT)]
  trellisServer.proc = spawn(TRELLIS_PY, args, {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', logFd, logFd], env,
  })
  trellisServer.proc.on('error', (e) => { try { writeSync(logFd, 'errore spawn: ' + e.message + '\n') } catch { /* log chiuso */ } })
  trellisServer.proc.on('exit', () => {
    trellisServer.proc = null
    trellisServer.ready = false
    trellisServer.load_time_s = null
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

// proxy LM Studio (OpenAI-compatible, di default :1234). Pass-through generico
// di metodo/body/query: copre sia le risposte JSON (/v1/models) sia lo stream
// SSE (/v1/chat/completions). Serve i modelli vision-language per il gioco.
function proxyLmStudio(req, res, path) {
  const u = new URL(req.url, 'http://localhost')
  const rest = path.replace(/^\/api\/lmstudio/, '') || '/'
  const target = new URL(LMSTUDIO)
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const preq = httpRequest({
      host: target.hostname, port: target.port, path: rest + u.search,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length || undefined,
        Accept: 'text/event-stream, application/json',
      },
    }, (pres) => {
      res.writeHead(pres.statusCode || 200, {
        'Content-Type': pres.headers['content-type'] || 'application/json',
        'Cache-Control': 'no-store',
      })
      pres.pipe(res)
    })
    preq.on('error', (e) => {
      if (!res.headersSent) {
        json(res, 502, { error: { message: `LM Studio non raggiungibile (${e.message}) — avvialo e carica il modello vision-language` } })
      } else {
        res.end()
      }
    })
    preq.end(body)
  })
  req.on('error', () => res.end())
}

// ── cronologia immagini (persistente su outputs/history) ─────────────────
// Le immagini generate vengono salvate su disco (niente limiti localStorage)
// con un indice JSON; la lista è limitata alle ultime HIST_MAX.
const HIST_DIR = join(ROOT, 'outputs', 'history')
const HIST_INDEX = join(HIST_DIR, 'index.json')
const HIST_MAX = 60

function histIndex() {
  try { return JSON.parse(readFileSync(HIST_INDEX, 'utf8')) } catch { return [] }
}

function histSave(list) {
  mkdirSync(HIST_DIR, { recursive: true })
  writeFileSync(HIST_INDEX, JSON.stringify(list))
}

async function handleHistory(req, res, path) {
  // lista metadati (immagini caricate lazy via /api/history/img/<id>)
  if (path === '/api/history' && req.method === 'GET') {
    return json(res, 200, histIndex())
  }

  // svuota tutto (file + indice)
  if (path === '/api/history/clear' && req.method === 'POST') {
    try {
      for (const e of histIndex()) {
        try { unlinkSync(join(HIST_DIR, e.id)) } catch { /* già sparito */ }
      }
      histSave([])
      return json(res, 200, { ok: true })
    } catch (e) {
      return json(res, 500, { error: { message: e.message } })
    }
  }

  // elimina una singola voce (file + indice)
  const dm = path.match(/^\/api\/history\/delete\/([^/]+)$/)
  if (dm && req.method === 'POST') {
    const id = dm[1]
    if (!/^[a-zA-Z0-9._-]+$/.test(id) || !id.endsWith('.png')) {
      return json(res, 400, { error: { message: 'id non valido' } })
    }
    const list = histIndex()
    const next = list.filter((e) => e.id !== id)
    if (next.length === list.length) {
      return json(res, 404, { error: { message: 'voce non trovata' } })
    }
    try { unlinkSync(join(HIST_DIR, id)) } catch { /* già sparito */ }
    histSave(next)
    return json(res, 200, { ok: true })
  }

  // salva una generazione
  if (path === '/api/history/save' && req.method === 'POST') {
    return queued(async () => {
      try {
        const b = await readBody(req)
        const { model, prompt, size, seed, steps, timeMs, dataUrl } = b
        if (!dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
          return json(res, 400, { error: { message: 'dataUrl png mancante' } })
        }
        mkdirSync(HIST_DIR, { recursive: true })
        const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
        writeFileSync(join(HIST_DIR, id), buf)
        const list = histIndex()
        list.unshift({ id, model, prompt, size, seed, steps, timeMs, ts: Date.now() })
        // cap: cancella i file fuori lista
        const drop = list.splice(HIST_MAX)
        for (const d of drop) {
          try { unlinkSync(join(HIST_DIR, d.id)) } catch { /* già sparito */ }
        }
        histSave(list)
        return json(res, 200, { ok: true, id })
      } catch (e) {
        return json(res, 500, { error: { message: e.message } })
      }
    })
  }

  // serve un'immagine dell'archivio
  const m = path.match(/^\/api\/history\/img\/([^/]+)$/)
  if (m && req.method === 'GET') {
    const id = m[1]
    if (!/^[a-zA-Z0-9._-]+$/.test(id) || !id.endsWith('.png')) {
      return json(res, 400, { error: { message: 'id non valido' } })
    }
    const abs = join(HIST_DIR, id)
    if (!abs.startsWith(HIST_DIR)) return json(res, 403, { error: { message: 'forbidden' } })
    try {
      const data = await readFile(abs)
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(data)
      return
    } catch {
      return json(res, 404, { error: { message: 'immagine non trovata' } })
    }
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
}

// ── knowledge base llm-wiki (pattern Karpathy: raw/ → wiki/ compilata) ───
// Le fonti grezze stanno in knowledge/raw/, il modello le compila in pagine
// markdown in knowledge/wiki/ con index.md e log.md. Ricerca keyword
// (zero dipendenze); niente embeddings a questa scala.
const KB_DIR = join(ROOT, 'knowledge')
const KB_RAW = join(KB_DIR, 'raw')
const KB_WIKI = join(KB_DIR, 'wiki')
const KB_INDEX = join(KB_DIR, 'index.md')
const KB_LOG = join(KB_DIR, 'log.md')
const KB_SCHEMA = join(KB_DIR, 'SCHEMA.md')

const KB_SCHEMA_SEED = `# Schema della wiki (llm-wiki)

Sei il manutentore della knowledge base di Palamede. Segui queste regole.

## Struttura

- knowledge/raw/ — fonti grezze (leggi, non modificare)
- knowledge/wiki/ — pagine compilate da te: wiki/sources/ (una pagina per fonte),
  wiki/concepts/ (concetti trasversali), wiki/entities/ (entità rilevanti)
- knowledge/index.md — indice: ogni pagina con link e una riga di sintesi
- knowledge/log.md — registro append-only di cosa hai fatto e quando

## Come compilare una fonte (ingest)

1. Leggi la fonte in raw/.
2. Crea wiki/sources/<slug>.md: una pagina di sintesi con i punti chiave,
   citando la fonte e i concetti coinvolti.
3. Aggiorna o crea pagine concept/entity quando la fonte introduce concetti
   nuovi o contraddice pagine esistenti (segnala le contraddizioni!).
4. Aggiorna index.md: aggiungi le pagine nuove e aggiorna le sintesi.
5. Appendi una riga al log.md nel formato:
   ## [AAAA-MM-GG] ingest | <nome fonte>

## Stile delle pagine

- Markdown pulito, collegamenti [[wikilink]] tra pagine dove serve.
- Ogni pagina inizia con: # Titolo, poi una riga di sintesi in corsivo.
- Fatti e misure vanno attribuiti alla fonte (es. "secondo <fonte>").
- Niente inventato: se una cosa non è nella fonte, non scriverla.

## Formato di output

Quando ti viene chiesto un ingest, rispondi SOLO con questo formato
(niente testo fuori dai blocchi):

<<<FILE wiki/sources/<slug>.md>>>
<contenuto della pagina, markdown>
<<<END>>>

... (un blocco <<<FILE>>> per ogni pagina creata/aggiornata) ...

<<<INDEX>>>
<index.md COMPLETO aggiornato>
<<<END>>>

<<<LOG>>>
## [AAAA-MM-GG] ingest | <nome fonte>
<<<END>>>
`

function ensureKb() {
  mkdirSync(KB_RAW, { recursive: true })
  mkdirSync(KB_WIKI, { recursive: true })
  if (!existsSync(KB_INDEX)) writeFileSync(KB_INDEX, '# Indice della wiki\n\n_Ancora vuota: aggiungi fonti in raw/ e compilale._\n')
  if (!existsSync(KB_LOG)) writeFileSync(KB_LOG, '# Registro della wiki\n')
  if (!existsSync(KB_SCHEMA)) writeFileSync(KB_SCHEMA, KB_SCHEMA_SEED)
}

function kbReadSafe(abs, fallback = '') {
  try { return readFileSync(abs, 'utf8') } catch { return fallback }
}

// Path relativo dentro knowledge/ (es. "raw/nota.md", "wiki/sources/x.md",
// "index.md"). Rifiuta assoluti, "..", backslash e drive Windows.
function kbResolve(rel) {
  if (typeof rel !== 'string' || !rel) return null
  if (rel.includes('\\') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/')) return null
  const abs = normalize(join(KB_DIR, rel))
  if (abs !== KB_DIR && !abs.startsWith(KB_DIR + '\\') && !abs.startsWith(KB_DIR + '/')) return null
  if (rel.split('/').includes('..')) return null
  return abs
}

function kbWalk(dir, base = '') {
  const out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const abs = join(dir, name)
    let st = null
    try { st = statSync(abs) } catch { continue }
    const rel = base ? `${base}/${name}` : name
    if (st.isDirectory()) out.push(...kbWalk(abs, rel))
    else out.push({ name: rel, bytes: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function kbSearchPages(query, limit = 8) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9à-ÿ_]+/i).filter((t) => t.length >= 2)
  if (!terms.length) return []
  const files = kbWalk(KB_WIKI).filter((f) => f.name.endsWith('.md'))
  const scored = []
  for (const f of files) {
    const text = kbReadSafe(join(KB_WIKI, ...f.name.split('/'))).toLowerCase()
    // peso per lunghezza del termine: i termini lunghi (specifici) valgono di più
    let score = 0
    for (const t of terms) {
      let count = 0, idx = text.indexOf(t)
      while (idx !== -1 && count < 50) { count++; idx = text.indexOf(t, idx + t.length) }
      score += count * t.length
    }
    if (score > 0) scored.push({ path: f.name, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.path)
}

function parseIngestBlocks(text) {
  const files = []
  const fileRe = /<<<FILE\s+([^>]+)>>>([\s\S]*?)<<<END>>>/g
  let m
  while ((m = fileRe.exec(text)) !== null) {
    files.push({ path: m[1].trim(), content: m[2].replace(/^\r?\n/, '') })
  }
  const indexM = text.match(/<<<INDEX>>>([\s\S]*?)<<<END>>>/)
  const logM = text.match(/<<<LOG>>>([\s\S]*?)<<<END>>>/)
  return { files, index: indexM ? indexM[1].replace(/^\r?\n/, '') : null, log: logM ? logM[1].trim() : null }
}

async function handleKb(req, res, path) {
  ensureKb()
  const u = new URL(req.url, 'http://localhost')

  if (path === '/api/kb/status' && req.method === 'GET') {
    const raw = kbWalk(KB_RAW).length
    const wiki = kbWalk(KB_WIKI).filter((f) => f.name.endsWith('.md')).length
    return json(res, 200, {
      ok: true, raw, wiki,
      index: kbReadSafe(KB_INDEX), log: kbReadSafe(KB_LOG), schema: kbReadSafe(KB_SCHEMA),
      chat: textStatus(),
    })
  }

  if (path === '/api/kb/files' && req.method === 'GET') {
    const area = u.searchParams.get('area')
    if (area !== 'raw' && area !== 'wiki') return json(res, 400, { error: { message: 'area deve essere raw|wiki' } })
    const dir = area === 'raw' ? KB_RAW : KB_WIKI
    return json(res, 200, { area, files: kbWalk(dir) })
  }

  if (path === '/api/kb/read' && req.method === 'GET') {
    const rel = u.searchParams.get('path') || ''
    const abs = kbResolve(rel)
    if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
    try {
      const st = statSync(abs)
      if (st.isDirectory()) return json(res, 400, { error: { message: 'è una cartella' } })
      return json(res, 200, { path: rel, content: readFileSync(abs, 'utf8') })
    } catch {
      return json(res, 404, { error: { message: 'file non trovato' } })
    }
  }

  if (path === '/api/kb/save' && req.method === 'POST') {
    const b = await readBody(req)
    const rel = String(b.path || '')
    const content = typeof b.content === 'string' ? b.content : null
    if (content === null) return json(res, 400, { error: { message: 'content mancante' } })
    if (!/^(raw|wiki)\//.test(rel) || !/\.(md|txt)$/i.test(rel)) {
      return json(res, 400, { error: { message: 'path deve essere raw/... o wiki/... (.md/.txt)' } })
    }
    const abs = kbResolve(rel)
    if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
    try {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
      return json(res, 200, { ok: true, path: rel })
    } catch (e) {
      return json(res, 500, { error: { message: e.message } })
    }
  }

  if (path === '/api/kb/delete' && req.method === 'POST') {
    const b = await readBody(req)
    const rel = String(b.path || '')
    if (!/^raw\//.test(rel)) return json(res, 400, { error: { message: 'si elimina solo da raw/' } })
    const abs = kbResolve(rel)
    if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
    try { unlinkSync(abs) } catch { return json(res, 404, { error: { message: 'file non trovato' } }) }
    return json(res, 200, { ok: true })
  }

  if (path === '/api/kb/search' && req.method === 'GET') {
    const q = u.searchParams.get('q') || ''
    return json(res, 200, { query: q, pages: kbSearchPages(q) })
  }

  if (path === '/api/kb/embeddings' && req.method === 'GET') {
    // Ollama locale (opzionale): se espone embeddinggemma, la UI lo segnala
    // come pronto per il futuro RAG vettoriale. Ricerca resta keyword.
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })
      if (!r.ok) throw new Error('ollama ' + r.status)
      const j = await r.json()
      const models = (j.models || []).map((m) => m.name || m.model).filter(Boolean)
      const emb = models.filter((n) => /embed/i.test(n))
      return json(res, 200, { available: emb.length > 0, models: emb.length ? emb : models })
    } catch {
      return json(res, 200, { available: false, models: [] })
    }
  }

  if (path === '/api/kb/ingest' && req.method === 'POST') {
    const b = await readBody(req)
    const source = String(b.source || '').split('/').pop()
    if (!source || !/^[\w.\- ]+\.(md|txt)$/i.test(source)) {
      return json(res, 400, { error: { message: 'source deve essere un file .md/.txt in raw/' } })
    }
    const srcAbs = kbResolve('raw/' + source)
    if (!srcAbs || !existsSync(srcAbs)) return json(res, 404, { error: { message: 'fonte non trovata in raw/' } })
    if (!(textServer.proc && !textServer.proc.killed) || !textServer.ready) {
      return json(res, 409, { error: { message: 'server chat spento: avvialo dalla pagina Chat prima di compilare' } })
    }
    return queued(async () => {
      try {
        const fonte = readFileSync(srcAbs, 'utf8').slice(0, 12000)
        const schema = kbReadSafe(KB_SCHEMA, KB_SCHEMA_SEED)
        const index = kbReadSafe(KB_INDEX).slice(0, 4000)
        const system = `${schema}\n\nFonte da compilare (knowledge/raw/${source}):\n${fonte}\n\nIndice attuale:\n${index}`
        const r = await fetch(`http://127.0.0.1:${TEXT_PORT}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: `Compila la fonte "${source}" nella wiki. Rispondi SOLO coi blocchi <<<FILE>>>/<<<INDEX>>>/<<<LOG>>>.` },
            ],
            stream: false, temperature: 0.3,
          }),
          signal: AbortSignal.timeout(600_000),
        })
        if (!r.ok) throw new Error(`llama-server: HTTP ${r.status}`)
        const j = await r.json()
        const out = j?.choices?.[0]?.message?.content || ''
        const { files, index: newIndex, log: newLog } = parseIngestBlocks(out)
        const written = []
        if (!files.length || newIndex === null) {
          // formato non rispettato: salva il grezzo per ispezione, con errore esplicito
          const slug = source.replace(/\.(md|txt)$/i, '').replace(/[^\w\-]+/g, '-').toLowerCase()
          const fallbackRel = `wiki/sources/${slug}-raw.md`
          const fallbackAbs = kbResolve(fallbackRel)
          mkdirSync(dirname(fallbackAbs), { recursive: true })
          writeFileSync(fallbackAbs, `# ${source} (grezzo, formato ingest non rispettato)\n\n Risposta grezza del modello:\n\n${out}\n`)
          written.push(fallbackRel)
          return json(res, 200, { ok: false, written, error: 'il modello non ha rispettato il formato: risposta salvata come grezzo' })
        }
        for (const f of files) {
          const rel = f.path.replace(/^knowledge\//, '').replace(/\\/g, '/')
          if (!/^wiki\//.test(rel) || !/\.md$/i.test(rel)) continue
          const abs = kbResolve(rel)
          if (!abs) continue
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, f.content)
          written.push(rel)
        }
        if (newIndex !== null) { writeFileSync(KB_INDEX, newIndex); written.push('index.md') }
        if (newLog) { appendFileSync(KB_LOG, '\n' + newLog + '\n'); written.push('log.md') }
        return json(res, 200, { ok: true, written })
      } catch (e) {
        return json(res, 500, { error: { message: e.message } })
      }
    })
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
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
    stopTrellis(true)
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
    // serve un GLB già prodotto da outputs/3d (download / viewer)
    const fm = path.match(/^\/api\/3d\/file\/([^/]+)$/)
    if (fm) {
      const id = fm[1]
      if (!/^[a-zA-Z0-9._-]+$/.test(id) || !(id.endsWith('.glb') || id.endsWith('.stl'))) {
        return json(res, 400, { error: { message: 'id non valido' } })
      }
      const abs = join(ROOT, 'outputs', '3d', id)
      if (!abs.startsWith(join(ROOT, 'outputs', '3d'))) {
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
    stopText(true)
    return json(res, 200, textStatus())
  }

  if (path === '/api/chat' && req.method === 'POST') {
    return proxyChat(req, res)
  }

  // ── LM Studio (modelli vision-language, es. unsloth/lfm2.5-vl-3b) ──────
  if (path.startsWith('/api/lmstudio/')) {
    return proxyLmStudio(req, res, path)
  }

  // ── documentazione del progetto (sezione Progetto nella UI) ───────────
  if (path === '/api/doc' && req.method === 'GET') {
    const name = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '').toLowerCase()
    const file = DOC_FILES[name]
    if (!file) return json(res, 404, { error: { message: 'documento sconosciuto (mappa|readme|spec|security)' } })
    try {
      const text = await readFile(join(ROOT, file), 'utf8')
      return json(res, 200, { name: file, text })
    } catch {
      return json(res, 404, { error: { message: 'documento non trovato' } })
    }
  }

  if (path.startsWith('/api/history')) {
    return handleHistory(req, res, path)
  }

  if (path.startsWith('/api/kb/')) {
    return handleKb(req, res, path)
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 30 * 1024 * 1024) throw new Error('body troppo grande (max 30MB)')
    chunks.push(c)
  }
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
  const start = Date.now()
  res.on('finish', () => {
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
  if (path.startsWith('/api/') && !allowedOrigin(req)) return json(res, 403, { error: { message: 'origin non ammessa' } })
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