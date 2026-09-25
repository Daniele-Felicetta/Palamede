// Palamede hub — chat locale (llama.cpp llama-server come subprocess).
// Possiede textServer + start/stop/status/stream. kb.mjs riusa textStatus,
// isChatReady e TEXT_PORT per l'ingest (niente duplicazione di stato).

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT } from './root.mjs'
import { spawnLogged, killChild } from './proc.mjs'
import { proxyStream } from './proxy.mjs'

export const TEXT_PORT = Number(process.env.PALAMEDE_TEXT_PORT || 8121)
const LLAMA = join(ROOT, 'tools', 'llama-cpp', 'llama-server.exe')
const TEXT_LOG = join(ROOT, 'outputs', 'text-server.log')

// Elenco calcolato a ogni chiamata (non a import): un modello scaricato dal
// Downloader compare subito, senza riavviare il hub.
const TEXT_MODEL_DEFS = [
  { id: 'ornith-35b', name: 'Ornith 1.5 35B-A3B · Q4_K_M', moe: true,
    file: join(ROOT, 'models', 'ornith-1.5-35b', 'Ornith-1.5-35B-Q4_K_M.gguf'),
    mmproj: 'mmproj-Ornith-1.5-35B-BF16.gguf' },
  { id: 'ornith-9b', name: 'Ornith 1.5 9B · Q4_K_M', moe: false,
    file: join(ROOT, 'models', 'ornith-1.5-9b', 'Ornith-1.5-9B-Q4_K_M.gguf'),
    mmproj: 'mmproj-Ornith-1.5-9B-BF16.gguf' },
  { id: 'ornith-9b-q5', name: 'Ornith 1.5 9B · Q5_K_M', moe: false,
    file: join(ROOT, 'models', 'ornith-1.5-9b', 'Ornith-1.5-9B-Q5_K_M.gguf') },
  { id: 'k2-7b', name: 'K2 Horizon 7B · Q4_K_M', moe: false,
    file: join(ROOT, 'models', 'k2-7b', 'K2-Horizon-7B-Q4_K_M.gguf') },
  // K2 Horizon MoVA 36B-A4B: sparse MoE 100×8 + Mixture-of-Value attention
  // (64 esperti di valore, top-4). Architettura `k2-horizon` del fork llama.cpp
  // bundle (commit 35999d1); `mova: true` abilita l'offload del banco
  // attn_v_exps su CPU via `-ot` (--n-cpu-moe muove SOLO gli esperti FFN).
  { id: 'k2-36b', name: 'K2 Horizon 36B-A4B · Q4_K_M', moe: true, mova: true,
    file: join(ROOT, 'models', 'k2-36b', 'K2-Horizon-MoVA-36B-A4B-Q4_K_M.gguf') },
  { id: 'bonsai-27b', name: 'Bonsai 27B · Q1_0', moe: false,
    file: join(ROOT, 'models', 'bonsai-27b', 'Bonsai-27B-Q1_0.gguf') },
  // LFM2.5 VL 3B: vision-language (mmproj) per Bandersketch e chat multimodale.
  { id: 'lfm-vl-3b', name: 'LFM2.5 VL 3B · Q5_K_XL', moe: false,
    file: join(ROOT, 'models', 'lfm-vl-3b', 'LFM2.5-VL-3B-Q5_K_XL.gguf'),
    mmproj: 'mmproj-LFM2.5-VL-3B-F32.gguf' },
  // Gemma 4 26B-A4B MoE (3.8B attivi): narratore Bandersketch consigliato —
  // qualità da 30B con mmproj F16 (1.2GB) e --cpu-moe
  // scende a ~4.5GB VRAM a 36-40 tok/s. Pesi: release Unsloth IQ3_S.
  { id: 'gemma-4-26b', name: 'Gemma 4 26B-A4B · IQ3_S', moe: true,
    file: join(ROOT, 'models', 'gemma-4-26b', 'gemma-4-26B-A4B-it-UD-IQ3_S.gguf'),
    mmproj: 'mmproj-F16.gguf' },
  // MiniCPM5 2B: dense compatto (usato anche come reranker RAG su :8125).
  { id: 'minicpm5-2b', name: 'MiniCPM5 2B · Q4_K_M', moe: false,
    file: join(ROOT, 'models', 'minicpm5-2b', 'MiniCPM5-2B-Q4_K_M.gguf') },
]

/** Modelli con i file presenti (ricalcolato a ogni chiamata). */
function textModels() {
  return TEXT_MODEL_DEFS.filter((m) => existsSync(m.file))
}

/** Path del mmproj (preferito se presente, altrimenti il primo mmproj-*.gguf
 *  della cartella del modello). null se non c'è. */
function mmprojFor(m) {
  const dir = dirname(m.file)
  if (m.mmproj) {
    const p = join(dir, m.mmproj)
    if (existsSync(p)) return p
  }
  try {
    const f = readdirSync(dir).find((n) => /^mmproj-.*\.gguf$/i.test(n))
    if (f) return join(dir, f)
  } catch { /* cartella assente */ }
  return null
}

let textServer = { proc: null, model: null, params: null, ready: false }

async function textReady(timeoutMs = 3000) {
  try {
    const r = await fetch(`http://127.0.0.1:${TEXT_PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return (await r.json()).status === 'ok'
  } catch { /* giù */ }
  return false
}

export function textStatus() {
  return {
    running: !!(textServer.proc && !textServer.proc.killed),
    ready: !!textServer.ready,
    model: textServer.model,
    params: textServer.params,
    pid: textServer.proc ? textServer.proc.pid : null,
    models: textModels().map((m) => ({ id: m.id, name: m.name, moe: m.moe, mova: !!m.mova, file: m.file })),
  }
}

// true se il server chat è vivo E pronto (usato dal gate dell'ingest kb).
export function isChatReady() {
  return !!(textServer.proc && !textServer.proc.killed) && !!textServer.ready
}

export function stopText() {
  killChild(textServer.proc)
  textServer.proc = null
  textServer.model = null
  textServer.params = null
  textServer.ready = false
}

export async function startText(cfg) {
  if (textServer.proc) stopText()
  const model = textModels().find((m) => m.id === cfg.model)
  if (!model) throw new Error(`modello chat sconosciuto: ${cfg.model}`)
  const context = Math.min(65536, Math.max(1024, Number(cfg.context) || 8192))
  const kv = cfg.kv === 'f16' ? null : (['q8_0', 'q4_0', 'q5_0', 'iq4_nl'].includes(cfg.kv) ? cfg.kv : 'q8_0')
  const gpuLayers = Number.isFinite(Number(cfg.gpuLayers)) ? Math.max(-1, Number(cfg.gpuLayers)) : 99
  // cpuMoe: 0 = tutto su GPU, N>0 = primi N layer di esperti su RAM,
  // -1 = tutti gli esperti su RAM (coesistenza con i modelli immagine).
  const cpuMoe = Number.isFinite(Number(cfg.cpuMoe)) ? Math.max(-1, Number(cfg.cpuMoe)) : 0
  const movaCpu = cfg.movaCpu === true
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
  const mmproj = mmprojFor(model)
  if (mmproj) args.push('--mmproj', mmproj)
  // MoE su CPU: cpuMoe > 0 = primi N layer di esperti su RAM, cpuMoe === -1 =
  // tutti gli esperti su RAM (libera la VRAM per i modelli immagine).
  if (model.moe && cpuMoe === -1) args.push('--cpu-moe')
  else if (model.moe && cpuMoe > 0) args.push('--n-cpu-moe', String(cpuMoe))
  // MoVA (K2 Horizon): sposta il banco di esperti dell'attenzione (attn_v_exps)
  // su CPU per liberare VRAM. --n-cpu-moe non copre questo banco.
  if (model.mova && movaCpu) args.push('-ot', 'attn_v_exps=CPU')
  if (mtp) args.push('--spec-type', 'draft-mtp')
  args.push('--reasoning', thinking ? 'on' : 'off')

  if (!existsSync(LLAMA)) throw new Error(`manca ${LLAMA} — esegui scripts/setup.ps1`)
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })

  textServer.model = model.id
  textServer.params = { context, kv: kv || 'f16', mtp, cpuMoe, movaCpu, gpuLayers, thinking }
  textServer.ready = false
  const { proc } = spawnLogged({
    exe: LLAMA, args, cwd: ROOT, logFile: TEXT_LOG,
    header: `\n--- avvio ${model.id} ctx=${context} kv=${kv || 'f16'} mtp=${mtp} cpuMoe=${cpuMoe} movaCpu=${movaCpu ? 'on' : 'off'} ngl=${gpuLayers} think=${thinking ? 'on' : 'off'} ---\n`,
  })
  textServer.proc = proc
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
export function proxyChat(req, res) {
  return proxyStream(req, res, {
    host: '127.0.0.1', port: TEXT_PORT, path: '/v1/chat/completions',
    method: 'POST', accept: 'text/event-stream', defaultType: 'text/event-stream',
    errorMessage: 'llama-server non raggiungibile',
  })
}
