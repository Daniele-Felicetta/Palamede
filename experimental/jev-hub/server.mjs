// Palette hub — servizio dedicato che elenca e avvia i progetti jev.
//
// I progetti vivono in una cartella esterna (di default Desktop/jev-experiment,
// dove stanno i loro .venv e i pesi Spark); questo servizio NON copia pesi né
// ambienti, li avvia dal loro percorso originale. Palamede lo avvia e ne
// interroga /api/projects per mostrare/controllare i progetti.
//
// Zero dipendenze (node:http/child_process). Porta: env JE V_HUB_PORT, default 4610.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
// Radice progetti: env JE V_ROOT, oppure Desktop/jev-experiment, oppure la copia locale.
const CANDIDATES = [
  process.env.JEV_ROOT,
  join(homedir(), 'Desktop', 'jev-experiment'),
  join(__dirname, '..', 'jev-experiment'),
].filter(Boolean)
const JEV_ROOT = CANDIDATES.find((p) => existsSync(p)) || CANDIDATES[CANDIDATES.length - 1]

const PORT = Number(process.env.JEV_HUB_PORT || 4610)
const LOG_DIR = join(__dirname, 'logs')

// I stack Python dei progetti: rizzo-flow porta Spark+MLX (riusato anche da
// agent-encounter), jev-agent ha il suo venv (solo httpx).
const RIZZO_PY = join(JEV_ROOT, 'rizzo-flow', '.venv', 'Scripts', 'python.exe')
const JEV_PY = join(JEV_ROOT, 'jev-agent', '.venv', 'Scripts', 'python.exe')
const PNPM = process.env.JEV_PNPM || 'pnpm'

// Progetti esposti nell'hub. Ogni voce: come si avvia, dove, e su che porta
// risponde (porta usata per lo stato "running" e per aprire la UI).
const PROJECTS = [
  {
    id: 'rizzo-flow',
    name: 'Rizzo Flow',
    desc: 'Decisioni tipizzate locali con Spark-X2.5-4B (server API + playground).',
    cwd: join(JEV_ROOT, 'rizzo-flow'),
    port: 8017,
    exe: RIZZO_PY,
    args: ['-m', 'rizzo_flow.cli', 'serve', '--bits', '8'],
  },
  {
    id: 'jev-agent',
    name: 'jev-agent',
    desc: 'Agente decisionale a memoria persistente; usa rizzo-flow come backend.',
    cwd: join(JEV_ROOT, 'jev-agent'),
    port: 8018,
    exe: JEV_PY,
    args: ['-m', 'jev_agent.server', '--no-browser'],
  },
  {
    id: 'agent-encounter',
    name: 'agent-encounter',
    desc: 'Gioco top-down dove gli agenti si incontrano: rizzo-flow decide, Spark parla.',
    cwd: join(JEV_ROOT, 'agent-encounter'),
    port: 8019,
    exe: RIZZO_PY,
    args: ['run.py', '--no-browser'],
  },
  {
    id: 'my-jev',
    name: 'my-jev',
    desc: 'Il gioco JEV (SvelteKit) con MiniCPM e K2-Horizon locali.',
    cwd: join(JEV_ROOT, 'my-jev'),
    port: 5173,
    exe: PNPM,
    args: ['dev'],
  },
]

// processi vivi: id -> child
const live = new Map()

function logFileFor(id) {
  mkdirSync(LOG_DIR, { recursive: true })
  return join(LOG_DIR, `${id}.log`)
}

function spawnProject(p) {
  if (live.has(p.id)) return
  if (!existsSync(p.exe) && !p.exe.match(/\.(exe|bat|cmd)$/i)) {
    // prova a risolverlo sul PATH (es. pnpm)
  }
  const logFd = openSync(logFileFor(p.id), 'a')
  writeSync(logFd, `\n--- avvio ${p.id} @ ${new Date().toISOString()} ---\n`)
  const proc = spawn(p.exe, p.args, {
    cwd: p.cwd,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  })
  proc.on('error', (e) => {
    try { writeSync(logFd, 'errore spawn: ' + e.message + '\n') } catch { /* log chiuso */ }
    live.delete(p.id)
  })
  proc.on('exit', () => { live.delete(p.id) })
  live.set(p.id, proc)
}

function stopProject(id) {
  const proc = live.get(id)
  if (!proc) return
  try {
    // albero di processi (vite/powershell figli): taskkill /T
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch { try { proc.kill('SIGKILL') } catch { /* già morto */ } }
  live.delete(id)
}

function portOpen(port, timeoutMs = 500) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (open) => { socket.destroy(); done(open) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}

async function projectStatus(p) {
  return {
    id: p.id,
    name: p.name,
    desc: p.desc,
    port: p.port,
    url: `http://127.0.0.1:${p.port}/`,
    started: live.has(p.id),
    running: await portOpen(p.port),
    cwd: p.cwd,
  }
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

async function handleApi(req, res, path) {
  if (path === '/api/projects' && req.method === 'GET') {
    const items = []
    for (const p of PROJECTS) items.push(await projectStatus(p))
    return json(res, 200, { root: JEV_ROOT, running: existsSync(JEV_ROOT), items })
  }

  if (path.startsWith('/api/projects/') && req.method === 'POST') {
    const m = path.match(/^\/api\/projects\/([a-z0-9-]+)\/(start|stop)$/)
    if (!m) return json(res, 404, { error: { message: 'endpoint inesistente' } })
    const p = PROJECTS.find((x) => x.id === m[1])
    if (!p) return json(res, 404, { error: { message: 'progetto sconosciuto' } })
    if (m[2] === 'start') {
      if (!existsSync(p.cwd)) return json(res, 500, { error: { message: `cartella mancante: ${p.cwd}` } })
      spawnProject(p)
    } else {
      stopProject(p.id)
      // dà tempo all'OS di liberare la porta, così lo stato riportato è reale
      await new Promise((r) => setTimeout(r, 800))
    }
    return json(res, 200, await projectStatus(p))
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  try {
    if (path.startsWith('/api/')) return await handleApi(req, res, path)
    // Landing minimale: elenco + link (l'UI vera la mostra Palamede).
    const items = []
    for (const p of PROJECTS) {
      const s = await projectStatus(p)
      items.push(`<li><b>${s.name}</b> ${s.running ? '● attivo' : '○ fermo'} — <a href="${s.url}">${s.url}</a><br><small>${s.desc}</small></li>`)
    }
    const html = `<!doctype html><meta charset="utf-8"><title>JEV Hub</title><body style="font:14px system-ui;background:#14141a;color:#e8e8ee;padding:24px"><h1>JEV Hub</h1><p>Radice: <code>${JEV_ROOT}</code></p><ul>${items.join('')}</ul></body>`
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(html)
  } catch (e) {
    return json(res, 500, { error: { message: e.message } })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`JEV Hub su http://127.0.0.1:${PORT}`)
  console.log(`  radice progetti: ${JEV_ROOT}`)
})
