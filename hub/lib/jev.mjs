// Palamede hub — JEV Hub (esperimenti jev), servizio Node separato :4610.
// Palamede avvia il servizio jev-hub (experimental/jev-hub/server.mjs) come
// subprocess e inoltra le richieste /api/jev/*: elenco progetti, start/stop.
// I progetti veri e propri (rizzo-flow, jev-agent, agent-encounter, my-jev)
// girano dal loro percorso originale — li gestisce jev-hub, non Palamede.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { json, errorJson, proxyJson } from './http.mjs'
import { spawnLogged, killChild } from './proc.mjs'

const JEV_HUB_PORT = Number(process.env.PALAMEDE_JEV_PORT || 4610)
const JEV_HUB_URL = `http://127.0.0.1:${JEV_HUB_PORT}`
const JEV_HUB_SCRIPT = join(ROOT, 'experimental', 'jev-hub', 'server.mjs')
const JEV_HUB_LOG = join(ROOT, 'outputs', 'jev-hub.log')

let jevHub = { proc: null }

async function hubUp(timeoutMs = 2000) {
  try {
    const r = await fetch(`${JEV_HUB_URL}/api/projects`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch { return false }
}

export async function jevHubStatus() {
  const running = !!(jevHub.proc && !jevHub.proc.killed)
  return { running, up: running ? await hubUp() : false, port: JEV_HUB_PORT, script: existsSync(JEV_HUB_SCRIPT) }
}

export function stopJevHub() {
  killChild(jevHub.proc)
  jevHub.proc = null
}

export async function startJevHub() {
  if (jevHub.proc && !jevHub.proc.killed) return await jevHubStatus()
  if (!existsSync(JEV_HUB_SCRIPT)) throw new Error(`manca ${JEV_HUB_SCRIPT}`)
  const { proc } = spawnLogged({
    exe: process.execPath,
    args: [JEV_HUB_SCRIPT],
    cwd: ROOT,
    env: { ...process.env, JEV_HUB_PORT: String(JEV_HUB_PORT) },
    logFile: JEV_HUB_LOG,
    header: `\n--- avvio JEV Hub su porta ${JEV_HUB_PORT} ---\n`,
  })
  jevHub.proc = proc
  jevHub.proc.on('exit', () => { jevHub.proc = null })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (!jevHub.proc) throw new Error('jev-hub è uscito durante l\'avvio (vedi outputs/jev-hub.log)')
    if (await hubUp()) return await jevHubStatus()
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('jev-hub non pronto entro 15s (vedi outputs/jev-hub.log)')
}

// ── route /api/jev/* ──────────────────────────────────────────────────────
// Avvia on-demand il servizio se spento, poi inoltra la richiesta.
export async function handleJev(req, res, path) {
  const sub = path.replace(/^\/api\/jev/, '') || '/projects'
  if (sub === '/status' && req.method === 'GET') {
    return json(res, 200, await jevHubStatus())
  }
  if (sub === '/start' && req.method === 'POST') {
    try { return json(res, 200, await startJevHub()) }
    catch (e) { return errorJson(res, e) }
  }
  if (sub === '/stop' && req.method === 'POST') {
    stopJevHub()
    return json(res, 200, await jevHubStatus())
  }
  // richieste ai progetti: assicura che l'hub sia su, poi proxy.
  // jev-hub espone le API sotto /api/* (es. /api/projects), quindi rimappiamo
  // /api/jev/projects -> /api/projects.
  if (!(await hubUp())) {
    try { await startJevHub() } catch (e) { return json(res, 502, { error: { message: e.message } }) }
  }
  return proxyJson(req, res, '/api' + sub, 30_000, JEV_HUB_URL)
}
