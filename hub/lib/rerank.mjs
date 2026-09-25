// Palamede hub — reranker RAG dedicato (MiniCPM 2B via llama-server).
// Istanza SEPARATA dalla chat (porta propria RERANK_PORT, default 8125):
// NON registra modelli in chat.mjs (lo fa l'altro branch), vive qui.
// NB: la porta del reranker NON deve coincidere con quella di sd-server
// (modelserver.py, default 8123): sd-server resta in ascolto finché un
// modello immagine è caricato, e un reranker sulla stessa porta non
// riuscirebbe a partire.
// Ciclo di vita: start lazy alla prima richiesta, idle timeout ~60s → kill
// per liberare VRAM. Tutto best-effort: se il server non parte o non è
// pronto, i chiamanti (rag.mjs) degradano al ranking ibrido senza errori.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { spawnLogged, killChild } from './proc.mjs'

export const RERANK_PORT = Number(process.env.PALAMEDE_RERANK_PORT || 8125)
const RERANK_GGUF = join(ROOT, 'models', 'minicpm5-2b', 'MiniCPM5-2B-Q4_K_M.gguf')
const LLAMA = join(ROOT, 'tools', 'llama-cpp', 'llama-server.exe')
const RERANK_LOG = join(ROOT, 'outputs', 'rerank-server.log')

const IDLE_MS = 60_000
const START_TIMEOUT_MS = 60_000
const RERANK_TIMEOUT_MS = 45_000

let srv = { proc: null, logFd: null, ready: false, pid: null, uses: 0, lastUse: 0, lastError: null }

export function rerankStatus() {
  return {
    running: !!(srv.proc && !srv.proc.killed),
    ready: !!srv.ready,
    pid: srv.pid,
    model: 'minicpm5-2b',
    uses: srv.uses,
    file: RERANK_GGUF,
    error: srv.lastError,
  }
}

function touch() {
  srv.uses++
  srv.lastUse = Date.now()
}

async function rerankReady(timeoutMs = 3000) {
  try {
    const r = await fetch(`http://127.0.0.1:${RERANK_PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return (await r.json()).status === 'ok'
  } catch { /* giù */ }
  return false
}

// Avvia il reranker (idempotente). Ritorna true se pronto.
export async function startRerank(timeoutMs = START_TIMEOUT_MS) {
  if (srv.proc && !srv.proc.killed) {
    if (srv.ready) { touch(); return true }
    // già avviato ma in caricamento: aspetta il timeout
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!srv.proc || srv.proc.killed) break
      if (await rerankReady(2000)) { srv.ready = true; touch(); return true }
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  if (!existsSync(RERANK_GGUF)) {
    srv.lastError = 'manca MiniCPM 2B (models/minicpm5-2b)'
    return false
  }
  if (!existsSync(LLAMA)) {
    srv.lastError = `manca ${LLAMA} — esegui scripts/setup.ps1`
    return false
  }

  srv.ready = false
  srv.lastError = null
  const args = [
    '-m', RERANK_GGUF,
    '--host', '127.0.0.1', '--port', String(RERANK_PORT),
    '-c', '4096',
    '-ngl', '99',
    '--flash-attn', 'on',
    '--no-warmup',
  ]
  const { proc, logFd } = spawnLogged({
    exe: LLAMA, args, cwd: ROOT, logFile: RERANK_LOG,
    header: `\n--- avvio reranker minicpm5-2b :${RERANK_PORT} ---\n`,
  })
  srv.proc = proc
  srv.logFd = logFd
  proc.on('exit', () => { srv.proc = null; srv.ready = false; srv.pid = null })

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!srv.proc || srv.proc.killed) {
      srv.lastError = 'llama-server è uscito durante l\'avvio (vedi outputs/rerank-server.log)'
      return false
    }
    if (await rerankReady(2000)) {
      srv.ready = true
      srv.pid = proc.pid
      touch()
      return true
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  srv.lastError = 'reranker non pronto entro il timeout (vedi outputs/rerank-server.log)'
  return false
}

export function stopRerank() {
  killChild(srv.proc)
  if (srv.logFd) { try { srv.logFd.close() } catch { /* già chiuso */ } }
  srv.proc = null
  srv.logFd = null
  srv.ready = false
  srv.pid = null
  srv.lastUse = 0
}

// Watchdog idle: libera la VRAM quando il reranker non serve più.
// unref(): il timer non tiene vivo il processo (importabile nei test).
setInterval(() => {
  if (srv.proc && !srv.proc.killed && srv.lastUse && Date.now() - srv.lastUse > IDLE_MS) {
    stopRerank()
  }
}, 5000).unref()

function buildPrompt(query, candidates) {
  const items = candidates
    .map((c, i) => `#${i + 1} ${c.text.replace(/\s+/g, ' ').slice(0, 280)}`)
    .join('\n')
  return `Sei un selettore di fonti per una knowledge base.
Ti do una domanda e dei frammenti numerati. Rispondi SOLO con i numeri dei
frammenti che servono a rispondere alla domanda, dal più utile al meno utile,
separati da virgola. Massimo 5 numeri. Se nessun frammento è utile, rispondi: 0

Domanda: ${query}

${items}`
}

// Rerank dei candidati (best-effort). Ritorna gli id riordinati dal più utile
// al meno utile, o null se il reranker non è disponibile o la risposta non è
// parsabile (il chiamante ripiega sul ranking ibrido).
export async function rerankChunks(query, candidates) {
  if (!candidates.length) return null
  if (srv.ready && !(srv.proc && !srv.proc.killed)) srv.ready = false
  if (!srv.ready) {
    const ok = await startRerank(30_000)
    if (!ok) return null
  }
  touch()
  try {
    const r = await fetch(`http://127.0.0.1:${RERANK_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Rispondi solo con i numeri richiesti.' },
          { role: 'user', content: buildPrompt(query, candidates) },
        ],
        stream: false,
        temperature: 0,
        max_tokens: 32,
        seed: 0,
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    })
    if (!r.ok) throw new Error('rerank HTTP ' + r.status)
    const j = await r.json()
    const content = j?.choices?.[0]?.message?.content || ''
    const nums = (content.match(/\d+/g) || []).map((n) => parseInt(n, 10) - 1)
      .filter((i) => i >= 0 && i < candidates.length)
    if (!nums.length) return null
    return [...new Set(nums)].map((i) => candidates[i].id)
  } catch {
    return null
  }
}