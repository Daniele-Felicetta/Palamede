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
// dopo quanto un timing va considerato "vecchio" (mostrato come ultimo, non live)
const STALE_MS = 15000
// quanto tenere del log al primo avvio hub: parti dalla coda, non da capo,
// altrimenti mostri i timings di giorni fa finché non hai drenato tutto.
const BOOT_TAIL = 256 * 1024
let cached = null
let cachedAt = 0

// cursore di lettura del log
let logOffset = 0
let logBooted = false
let logCarry = ''
let logMtime = 0
// ultimi timings visti, con timestamp di quando sono stati parsati
let lastPrefill = null
let lastDecode = null
let liveProgress = null
/** Generazione in corso: tasso istantaneo tg_3s. Va a zero quando la
 *  richiesta finisce o dopo STALE_MS, cosi' la UI non mostra numeri vecchi. */
let liveDecode = null

async function getJson(p, timeoutMs = 2500) {
  const r = await fetch(`http://127.0.0.1:${TEXT_PORT}${p}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Legge le righe nuove del log e aggiorna gli ultimi timings. Drena tutto
 *  il cresciuto (non un solo chunk), così non resta indietro di N poll. */
function pumpLog() {
  let stat
  try { stat = statSync(LOG) } catch { return }
  const size = stat.size
  logMtime = stat.mtimeMs || 0
  // log ruotato o troncato (restart pulito): riparti da capo
  if (size < logOffset) { logOffset = 0; logCarry = '' }
  // primo pump dopo il boot hub: parti dalla coda, la storia vecchia non
  // deve apparire come "adesso".
  if (!logBooted) {
    logBooted = true
    if (size > BOOT_TAIL) { logOffset = size - BOOT_TAIL; logCarry = '' }
  }
  if (size === logOffset) return
  const CHUNK = 64 * 1024
  const fd = openSync(LOG, 'r')
  try {
    // drena finché non hai raggiunto size (ogni iterazione avanza l'offset)
    while (logOffset < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - logOffset))
      const n = readSync(fd, buf, 0, buf.length, logOffset)
      if (n <= 0) break
      logOffset += n
      const text = logCarry + buf.subarray(0, n).toString('utf8')
      const lines = text.split('\n')
      // l'ultimo pezzo puo' essere a meta' riga: tienolo per la prossima volta
      logCarry = lines.pop() ?? ''
      for (const line of lines) parseTiming(line)
    }
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
// Progresso LIVE della generazione, emesso ogni ~100 token:
//   "slot print_timing: id 3 | task 175 | n_gen = 100, tg = 25.20 t/s, tg_3s = 25.46 t/s"
// tg e' la media della richiesta, tg_3s l'istantanea su 3 s. Serve tg_3s perche'
// la media e' bugiarda qui: include i primi token a page cache fredda (misurati
// 10-13 t/s contro 26 a regime) e li schiaccia. Prima di questa regex la
// generazione non aveva alcuna sorgente live: il numero compariva solo dalla
// riga 'eval time' a risposta finita, cioe' dopo 8 s (200 token) o dopo minuti.
const RE_LIVE_DECODE = /\bn_gen\s*=\s*(\d+),\s*tg\s*=\s*([\d.]+)\s*t\/s,\s*tg_3s\s*=\s*([\d.]+)\s*t\/s/
const RE_SLOT_LINE = /\bid\s+(\d+)\s*\|\s*task\s+(-?\d+)/

function parseTiming(line) {
  const now = Date.now()
  const mLive = line.match(RE_LIVE)
  if (mLive) {
    const done = Number(mLive[1])
    const fraction = Number(mLive[2])
    const seconds = Number(mLive[3])
    const tps = Number(mLive[4])
    // ETA stimata dal progressivo: quanto manca a fraction=1
    const etaSec = fraction > 0.01 && fraction < 1 ? Math.max(0, (seconds / fraction) * (1 - fraction)) : 0
    liveProgress = { done, fraction, seconds, tps, etaSec, at: now }
    return
  }
  const slot = line.match(RE_SLOT_LINE)
  const id = slot ? Number(slot[1]) : null
  // generazione in corso: tasso istantaneo, senza toccare lastDecode (che
  // descrive l'ultima richiesta conclusa e serve al riepilogo)
  const mG = line.match(RE_LIVE_DECODE)
  if (mG) {
    liveDecode = { tokens: Number(mG[1]), avgTps: Number(mG[2]), tps: Number(mG[3]), slot: id, at: now }
    return
  }
  const mP = line.match(RE_PROMPT_EVAL)
  if (mP) {
    const ms = Number(mP[1])
    const tokens = Number(mP[2])
    lastPrefill = {
      ms, tokens, tps: Number(mP[3]),
      msPerToken: tokens > 0 ? ms / tokens : 0,
      slot: id, at: now,
    }
    return
  }
  const m = line.match(RE_EVAL)
  if (m && !line.includes('prompt eval time')) {
    lastDecode = { ms: Number(m[1]), tokens: Number(m[2]), msPerToken: Number(line.match(/([\d.]+)\s*ms per token/)?.[1] ?? 0), tps: Number(m[3]), slot: id, at: now }
    // richiesta conclusa: il progressivo del prefill non è più "in corso"
    liveProgress = null
    liveDecode = null
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
  // pompa SEMPRE il log, anche su cache-hit: i timings altrimenti restano
  // congelati per tutta la durata della cache.
  pumpLog()
  if (cached && now - cachedAt < TTL_MS) {
    cached.prefill = lastPrefill
    cached.decode = lastDecode
    cached.live = liveProgress
    cached.liveDecode = liveDecode && now - liveDecode.at < STALE_MS ? liveDecode : null
    cached.at = now
    cached.logMtime = logMtime
    return cached
  }
  const st = textStatus()

  // La fonte di verità è la PORTA, non lo stato interno dell'hub: il
  // llama-server può essere partito a mano (o da un'altra istanza dell'hub,
  // o dal bench) e in quel caso textStatus() direbbe running:false mentre
  // il server è lì e sanissimo.
  const alive = await getJson('/health', 1500).then((j) => j?.status === 'ok').catch(() => false)

  const base = {
    at: now,
    logMtime,
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
    liveDecode: liveDecode && now - liveDecode.at < STALE_MS ? liveDecode : null,
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

  // il "prefill in corso" senza righe fresche è un fantasma di una richiesta
  // finita: dopo 8s senza update, o senza slot al lavoro, non mostrarlo più.
  if (base.live && (now - (base.live.at || 0) > 8000 || !base.busySlot)) base.live = liveProgress = null
  base.prefill = lastPrefill
  base.decode = lastDecode

  cached = base
  cachedAt = now
  return cached
}

/** Resetta i cursori: utile se il log viene ruotato a mano. */
export function resetServerMetrics() {
  logOffset = 0
  logBooted = false
  logCarry = ''
  logMtime = 0
  lastPrefill = lastDecode = liveProgress = null
  cached = null
  cachedAt = 0
}