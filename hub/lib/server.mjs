// Palamede hub — zona "Server": telemetria del llama-server di testo (:8121).
// I tre pezzi che espone:
//   1. /health + /props  → modello caricato, contesto, parametri di default
//   2. /slots           → stato live di ogni slot (quello che fa LM Studio)
//   3. outputs/text-server.log → i timings che llama.cpp stampa a ogni
//      richiesta (prefill e decode). Serve il LOG e non /slots perché le
//      velocità sono pubblicate solo a richiesta conclusa: opencode parla
//      direttamente con :8121 e non passa dal proxy del hub, ma il timings
//      lo scrive llama.cpp comunque.
//
// Il log si legge a_offset crescenti (mai da capo): il file cresce di
// megabyte e rileggerlo tutto a ogni poll costerebbe piu' della richiesta.

import { statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { TEXT_PORT, textStatus } from './chat.mjs'

const LOG = join(ROOT, 'outputs', 'text-server.log')

// Cache breve: la pagina fa polling ~1.5s, /props e /slots sono due fetch
// locali ma non serve rispondere piu' volte al secondo.
const TTL_MS = 1200
let cached = null
let cachedAt = 0

// cursore di lettura del log
let logOffset = 0
let logCarry = ''
// ultimi timings visti, tenuti fra una richiesta e l'altra
let lastPrefill = null
let lastDecode = null
let liveProgress = null

async function getJson(p, timeoutMs = 2500) {
  const r = await fetch(`http://127.0.0.1:${TEXT_PORT}${p}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Legge le righe nuove del log e aggiorna gli ultimi timings. */
function pumpLog() {
  let size
  try { size = statSync(LOG).size } catch { return }
  // log ruotato o troncato (restart pulito): riparti da capo
  if (size < logOffset) { logOffset = 0; logCarry = '' }
  if (size === logOffset) return
  const CHUNK = 64 * 1024
  const fd = openSync(LOG, 'r')
  try {
    const buf = Buffer.alloc(Math.min(CHUNK, size - logOffset))
    const n = readSync(fd, buf, 0, buf.length, logOffset)
    logOffset += n
    const text = logCarry + buf.subarray(0, n).toString('utf8')
    const lines = text.split('\n')
    // l'ultimo pezzo puo' essere a meta' riga: tienolo per la prossima volta
    logCarry = lines.pop() ?? ''
    for (const line of lines) parseTiming(line)
  } catch {
    /* log non leggibile: si riprova al prossimo poll */
  } finally {
    closeSync(fd)
  }
}

// "slot print_timing: id  3 | task 0 |        eval time = 10756.83 ms /
//  184 tokens (   58.78 ms per token,    17.01 tokens per second)"
const RE_EVAL = /\beval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*[\d.]+\s*ms per token,\s*([\d.]+)\s*tokens per second/
// "prompt eval time = 798.97 ms / 11 tokens (… 13.77 tokens per second)"
const RE_PROMPT_EVAL = /\bprompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*[\d.]+\s*ms per token,\s*([\d.]+)\s*tokens per second/
// "prompt processing, n_tokens = 6144, progress = 0.21, t = 205.61 s /
//  29.88 tokens per second"
const RE_LIVE = /prompt processing, n_tokens\s*=\s*(\d+),\s*progress\s*=\s*([\d.]+),\s*t\s*=\s*([\d.]+)\s*s\s*\/\s*([\d.]+)\s*tokens per second/
const RE_SLOT_LINE = /\bid\s+(\d+)\s*\|\s*task\s+(-?\d+)/

function parseTiming(line) {
  const mLive = line.match(RE_LIVE)
  if (mLive) {
    liveProgress = {
      done: Number(mLive[1]),
      fraction: Number(mLive[2]),
      seconds: Number(mLive[3]),
      tps: Number(mLive[4]),
    }
    return
  }
  const slot = line.match(RE_SLOT_LINE)
  const id = slot ? Number(slot[1]) : null
  const mP = line.match(RE_PROMPT_EVAL)
  if (mP) {
    lastPrefill = { ms: Number(mP[1]), tokens: Number(mP[2]), tps: Number(mP[3]), slot: id }
    return
  }
  const m = line.match(RE_EVAL)
  if (m && !line.includes('prompt eval time')) {
    lastDecode = { ms: Number(m[1]), tokens: Number(m[2]), msPerToken: Number(line.match(/([\d.]+)\s*ms per token/)?.[1] ?? 0), tps: Number(m[3]), slot: id }
  }
}

/** Slot in elaborazione: quello che l'utente sta guardando in questo momento. */
function pickBusy(slots) {
  const busy = slots.filter((s) => s.processing)
  if (!busy.length) return null
  // il slot con piu' token di prompt e' quello della richiesta piu' pesante
  return busy.reduce((a, b) => ((b.promptTokens ?? 0) > (a.promptTokens ?? 0) ? b : a))
}

export async function serverMetrics() {
  const now = Date.now()
  if (cached && now - cachedAt < TTL_MS) return cached
  const st = textStatus()

  // La fonte di verità è la PORTA, non lo stato interno dell'hub: il
  // llama-server può essere partito a mano (o da un'altra istanza dell'hub,
  // o dal bench) e in quel caso textStatus() direbbe running:false mentre
  // il server è lì e sanissimo.
  const alive = await getJson('/health', 1500).then((j) => j?.status === 'ok').catch(() => false)

  const base = {
    running: alive,
    ready: alive,
    managed: !!st.running,
    model: st.model,
    params: st.params,
    pid: st.pid,
    port: TEXT_PORT,
    slots: [],
    busySlot: null,
    prefill: lastPrefill,
    decode: lastDecode,
    live: liveProgress,
    props: null,
  }

  if (!alive) {
    cached = base
    cachedAt = now
    return cached
  }

  const [props, slots] = await Promise.all([
    getJson('/props').catch(() => null),
    getJson('/slots').catch(() => null),
  ])

  if (props) {
    // n_ctx sta a un livello SOPRA params (default_generation_settings.n_ctx),
    // non dentro params come n_predict. n_predict invece è in params.
    const dgs = props.default_generation_settings ?? {}
    const p = dgs.params ?? {}
    base.props = {
      nCtx: dgs.n_ctx ?? 0,
      nPredict: p.n_predict ?? null,
      totalSlots: props.total_slots ?? null,
      modelPath: props.model_path ?? null,
      modelAlias: props.model_alias ?? null,
      ftype: props.model_ftype ?? null,
      buildInfo: props.build_info ?? null,
      sleeping: props.is_sleeping ?? false,
    }
  }

  if (Array.isArray(slots)) {
    base.slots = slots.map((s) => ({
      id: s.id,
      nCtx: s.n_ctx,
      processing: !!s.is_processing,
      task: s.id_task ?? null,
      promptTokens: s.n_prompt_tokens ?? 0,
      processed: s.n_prompt_tokens_processed ?? 0,
      cached: s.n_prompt_tokens_cache ?? 0,
      temperature: s.params?.temperature ?? null,
      maxTokens: s.params?.n_predict ?? null,
      speculative: !!s.speculative,
    }))
    base.busySlot = pickBusy(base.slots)
  }

  pumpLog()
  base.prefill = lastPrefill
  base.decode = lastDecode
  base.live = liveProgress

  cached = base
  cachedAt = now
  return cached
}

/** Resetta i cursori: utile se il log viene ruotato a mano. */
export function resetServerMetrics() {
  logOffset = 0
  logCarry = ''
  lastPrefill = lastDecode = liveProgress = null
  cached = null
  cachedAt = 0
}