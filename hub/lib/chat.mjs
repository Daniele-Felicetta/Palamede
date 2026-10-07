// Palamede hub — chat locale (llama.cpp llama-server come subprocess).
// Possiede textServer + start/stop/status/stream. kb.mjs riusa textStatus,
// isChatReady e TEXT_PORT per l'ingest (niente duplicazione di stato).

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { connect } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { ROOT } from './root.mjs'
import { spawnLogged, killChild } from './proc.mjs'
import { proxyStream } from './proxy.mjs'

export const TEXT_PORT = Number(process.env.PALAMEDE_TEXT_PORT || 8121)
// Build di llama.cpp. Si preferisce la piu' recente se presente: lo
// spec-decode MTP per Darwin richiede >= b11048 (il tensor 'output_hc_norm'
// mancante nel draft faceva fallire il load), e su b10648 non esiste. La
// cartella nuova e' un'estrazione a fianco, quindi tornare indietro basta
// rimuoverla. L'override esplicito resta per il bench e i test.
const LLAMA_DIRS = [
  process.env.PALAMEDE_LLAMA_DIR,
  join(ROOT, 'tools', 'llama-cpp-b11457'),
  join(ROOT, 'tools', 'llama-cpp'),
].filter(Boolean)
const LLAMA_DIR = LLAMA_DIRS.find((d) => existsSync(join(d, 'llama-server.exe'))) || LLAMA_DIRS.at(-1)
const LLAMA = join(LLAMA_DIR, 'llama-server.exe')
const TEXT_LOG = join(ROOT, 'outputs', 'text-server.log')
// Modalita' solo CPU: marcatore scritto da scripts/setup.ps1 -CpuOnly.
// Forza tutto su CPU (-ngl 0, niente flash-attn) qualunque cosa chieda la UI.
export const CPU_ONLY = existsSync(join(ROOT, 'tools', '.cpu'))

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
    file: join(ROOT, 'models', 'lfm', 'lfm-vl-3b', 'LFM2.5-VL-3B-Q5_K_XL.gguf'),
    mmproj: 'mmproj-LFM2.5-VL-3B-F32.gguf' },
  // Gemma 4 26B-A4B MoE (3.8B attivi): narratore Bandersketch consigliato —
  // qualità da 30B con mmproj F16 (1.2GB) e --cpu-moe
  // scende a ~4.5GB VRAM a 36-40 tok/s. Pesi: release Unsloth IQ3_S.
  { id: 'gemma-4-26b', name: 'Gemma 4 26B-A4B · IQ3_S', moe: true,
    file: join(ROOT, 'models', 'gemma-4-26b', 'gemma-4-26B-A4B-it-UD-IQ3_S.gguf'),
    mmproj: 'mmproj-F16.gguf' },
  // Gemma 4 12B IT QAT (Jarvis Brain): dense 12B, italiano, tool-calling,
  // audio-capable. Pesi in models/Jarvis (QAT UD-Q4_K_XL, ~6.7GB).
  { id: 'gemma-4-12b', name: 'Gemma 4 12B IT · QAT Q4', moe: false,
    file: join(ROOT, 'models', 'Jarvis', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf') },
  // MiniCPM5 2B: dense compatto (usato anche come reranker RAG su :8125).
  { id: 'minicpm5-2b', name: 'MiniCPM5 2B · Q4_K_M', moe: false,
    file: join(ROOT, 'models', 'minicpm5-2b', 'MiniCPM5-2B-Q4_K_M.gguf') },
  // POCKET-Darwin 180B: Qwen3.8-Flash-Next + RSI (arch. `qwen4exp`), MoE 512
  // esperti con 10 attivi per token (~3B attivi). Solo testo, niente vision
  // encoder. 111 GB in 4 shard: su 64 GB di RAM gli esperti restano su NVMe via
  // memory-map, i layer 45-48 finiscono in VRAM (--n-cpu-moe 44, vedi cpuMoe in
  // frontend/src/lib/text.ts). Punto -m sul PRIMO shard: llama-server segue i
  // metadati split.* e apre gli altri da solo.
  //
  // mtpHead: il GGUF non contiene i tensori nextn.* (verificato leggendo la
  // directory dei tensori), quindi lo spec-decode MTP serve l'head come file
  // separato. Quella di Unsloth e' del parent, ma R3 ha lasciato intatte le
  // head MTP: l'accettanza misurata e' del 69,9% con 2,40 token accettati per
  // passaggio, quindi l'head combacia col target.
  { id: 'pocket-darwin-180b', name: 'POCKET-Darwin 180B · UD-Q4_K_XL', moe: true, asyncOffload: true, maxContext: 262144,
    mtpHead: join(ROOT, 'models', 'mtp-Qwen3.8-Flash-Next-Q4_K_M.gguf'),
    file: join(ROOT, 'models', 'Pocket-Darwin-180B', 'POCKET-Darwin-180B-UD-Q4_K_XL-00001-of-00004.gguf') },
]

const SHARDED_GGUF = /^(.*?)-(\d+)-of-(\d+)\.gguf$/i

/** Un GGUF spezzato (`-00002-of-00004.gguf`) si carica solo se TUTTI gli shard
 *  sono in place: llama-server segue i metadati split.* e muore in load con un
 *  errore oscuro se ne manca uno. Per i modelli monofile basta existsSync. */
function modelFileReady(file) {
  // il match va fatto sul NOME del file: sul path intero la regex mangia
  // anche i segmenti di directory e i path ricostruiti non esistono più.
  const m = SHARDED_GGUF.exec(basename(file))
  if (!m) return existsSync(file)
  const [, stem, width, total] = m
  const dir = dirname(file)
  for (let i = 1; i <= Number(total); i++) {
    const n = String(i).padStart(width.length, '0')
    if (!existsSync(join(dir, `${stem}-${n}-of-${total}.gguf`))) return false
  }
  return true
}

/** Modelli con i file presenti (ricalcolato a ogni chiamata). */
function textModels() {
  return TEXT_MODEL_DEFS.filter((m) => modelFileReady(m.file))
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

let textServer = { proc: null, model: null, params: null, ready: false, replaced: false }

/** Trova e termina il llama-server che occupa TEXT_PORT senza essere nostro.
 *  Solo lo stesso eseguibile: se sulla porta c'è altro (LM Studio, un altro
 *  tool) non lo si tocca, si fallisce con un messaggio chiaro. */
async function killPortHolder() {
  const { execFile } = await import('node:child_process')
  // PID di chi ascolta su TEXT_PORT: netstat è già usato da metrics.mjs,
  // niente dipendenze nuove.
  const pids = await new Promise((done) => {
    execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true }, (err, stdout) => {
      if (err) return done([])
      const rows = String(stdout).split(/\r?\n/).filter((l) => l.includes(`:${TEXT_PORT}`) && /LISTENING/i.test(l))
      const found = rows
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((pid) => pid && pid !== String(process.pid))
      done([...new Set(found)])
    })
  })
  if (!pids.length) return false
  let killed = false
  for (const pid of pids) {
    const info = await new Promise((done) => {
      execFile('powershell', ['-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).ExecutablePath`,
      ], { windowsHide: true }, (err, stdout) => done(String(stdout || '').trim()))
    })
    // La porta puo' essere tenuta da una build diversa di llama.cpp (l'ho
    // appena cambiata): se il percorso e' sotto tools/llama-cpp* e' comunque
    // nostro e lo chiudiamo, altrimenti non lo tocchiamo.
    const ours = /[\\/]tools[\\/]llama-cpp[^\\/]*[\\/]llama-server\.exe$/i.test(info)
    if (!info || !ours) {
      throw new Error(`:${TEXT_PORT} è occupata da ${info || `pid ${pid}`} (non è llama-server di Palamede): libera la porta e riprova`)
    }
    // taskkill /T: llama-server non ha figli, ma /T è harmless e copre i
    // wrapper che potrebbero arrivare con --no-warmup.
    await new Promise((done) => {
      execFile('taskkill', ['/pid', pid, '/T', '/F'], { windowsHide: true }, () => done())
    })
    killed = true
  }
  if (killed) await new Promise((r) => setTimeout(r, 800))
  return killed
}

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
    replaced: !!textServer.replaced,
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

// Una sola partenza alla volta. Senza questo, due POST /api/chat/start
// ravvicinati (doppio click, UI che rilancia) vedono entrambi
// textServer.proc === null e spawnano: vince il bind su TEXT_PORT, l'altro
// fallisce ma RESTA VIVO con il modello in RAM — orfano che nessuno ferma e
// che falsifica ogni misura di VRAM/RAM. Stesso guard di rerank.mjs.
let starting = null

/** true se QUALUNQUE cosa ascolta su TEXT_PORT. Check a livello TCP, non
 *  HTTP: un occupante che non parla OpenAI API (un tool qualsiasi) non
 *  risponde a /health e va comunque intercettato PRIMA dello spawn. */
function portBusy() {
  return new Promise((done) => {
    const sock = connect({ host: '127.0.0.1', port: TEXT_PORT })
    const finish = (busy) => { try { sock.destroy() } catch { /* gia' chiuso */ } done(busy) }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.setTimeout(1200, () => finish(false))
  })
}

export function startText(cfg) {
  if (!starting) starting = bootText(cfg).finally(() => { starting = null })
  return starting
}

async function bootText(cfg) {
  if (textServer.proc) stopText()
  const model = textModels().find((m) => m.id === cfg.model)
  if (!model) throw new Error(`modello chat sconosciuto: ${cfg.model}`)
  // Tetto di contesto: 524288 (512k), il massimo dichiarato dai modelli
  // long-context (K2 Horizon). Va sciolto con cautela: la KV cache cresce
  // in modo lineare col contesto e puo' far fallire il load per OOM — con
  // 16 GB VRAM 64k resta il default sensato, 128k+ vuol dire macchina dedicata.
  // maxContext (opzionale, per modello) stringe il tetto dove il salto costa
  // davvero. Su Darwin il prefill scala col contesto anche a KV costante:
  // 4096 -> 58s, 131072 -> 65s, 262144 -> 102s, 524288 -> 184s (misurati con
  // prompt da 3662 token). 262144 e' l'ultimo che regge, e solo in q4_0
  // (in q8_0 a 262144 la KV e' 12,6 GB e il prefill va a 147s): e' il tetto
  // del profilo 'long-ctx'.
  const MAX_CONTEXT = 524288
  const contextCeil = Math.min(MAX_CONTEXT, Number(model.maxContext) || MAX_CONTEXT)
  const context = Math.min(contextCeil, Math.max(1024, Number(cfg.context) || 8192))
  const kv = cfg.kv === 'f16' ? null : (['q8_0', 'q4_0', 'q5_0', 'iq4_nl'].includes(cfg.kv) ? cfg.kv : 'q8_0')
  const gpuLayers = CPU_ONLY ? 0
    : (Number.isFinite(Number(cfg.gpuLayers)) ? Math.max(-1, Number(cfg.gpuLayers)) : 99)
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
    ...(CPU_ONLY ? [] : ['--flash-attn', 'on']),
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
  // Offload op asincrono: serve SOLO ai modelli i cui pesi arrivano dall'SSD
  // (111 GB su 64 GB di RAM -> ogni forward pass streama ~50 GB dal NVMe).
  // Misurato su Darwin: prefill 22,0s -> 5,2s, generazione 13,2 -> 11,1 t/s.
  // Sui modelli residenti in RAM e' un danno (K2 36B -48%, Gemma 26B -78%):
  // per questo e' opt-in per modello, mai globale.
  if (model.asyncOffload) args.push('--no-op-offload')
  // Spec-decode MTP: l'head e' un file separato (il GGUF non ha nextn.*) e va
  // in VRAM, altrimenti il suo forward attraversa il PCIe a ogni token e il
  // draft costa piu' di quanto faccia risparmiare. Con -ngl 99 --n-cpu-moe 44
  // il modello tiene ~14,5 dei 16,3 GB di VRAM e il draft da 2,6 non entra:
  // misurato -5%. Con --cpu-moe gli esperti vanno a RAM, la VRAM si libera e il
  // draft gira a velocita' piena: misurato +33% a 32k e +31% a 131k.
  let mtpActive = false
  if (mtp && model.mtpHead) {
    if (!existsSync(model.mtpHead)) {
      eprintln(`[chat] mtp: manca ${model.mtpHead} — spec-decode disattivato`)
    } else {
      args.push('--spec-type', 'draft-mtp', '-md', model.mtpHead,
        '--spec-draft-n-max', '2', '-ngld', 'all')
      mtpActive = true
    }
  }
  args.push('--reasoning', thinking ? 'on' : 'off')

  if (!existsSync(LLAMA)) throw new Error(`manca ${LLAMA} — esegui scripts/setup.ps1`)
  mkdirSync(join(ROOT, 'outputs'), { recursive: true })

  // Qualcun altro tiene TEXT_PORT (hub riavviato, istanza precedente
  // sopravvissuta): libero la porta, altrimenti il nuovo llama-server muore
  // sul bind e l'hub si mette in testa il processo sbagliato.
  if (await portBusy()) {
    textServer.replaced = true
    await killPortHolder()
  } else {
    textServer.replaced = false
  }

  textServer.model = model.id
  textServer.params = { context, kv: kv || 'f16', mtp: mtpActive, cpuMoe, movaCpu, gpuLayers, thinking }
  textServer.ready = false
  const { proc } = spawnLogged({
    exe: LLAMA, args, cwd: ROOT, logFile: TEXT_LOG,
    header: `\n--- avvio ${model.id} ctx=${context} kv=${kv || 'f16'} mtp=${mtpActive ? 'on' : mtp ? 'on(head-mancante)' : 'off'} cpuMoe=${cpuMoe} movaCpu=${movaCpu ? 'on' : 'off'} ngl=${gpuLayers} think=${thinking ? 'on' : 'off'} asyncOffload=${model.asyncOffload ? 'on' : 'off'} ---\n`,
  })
  textServer.proc = proc
  // L'handler deve azzerare il riferimento SOLO se è ancora questo proc: su un
  // riavvio il processo precedente può morire dopo che il nuovo è già stato
  // assegnato, e senza questo confronto il suo 'exit' azzerava il nuovo
  // riferimento: startText leggeva proc = null e dichiarava il server uscito
  // mentre era in ascolto e funzionante.
  proc.on('exit', () => {
    if (textServer.proc !== proc) return
    textServer.proc = null
    textServer.ready = false
  })

  // attesa readiness (i modelli grossi caricano in 10–60s; su CPU molto di piu')
  const waitMs = CPU_ONLY ? 750_000 : 150_000
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (!textServer.proc) throw new Error('llama-server è uscito durante l\'avvio (vedi outputs/text-server.log)')
    if (await textReady(2000)) {
      textServer.ready = true
      return textStatus()
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`llama-server non pronto entro ${Math.round(waitMs / 1000)}s (vedi outputs/text-server.log)`)
}

// proxy SSE: la risposta di llama-server viene passata byte per byte
export function proxyChat(req, res) {
  return proxyStream(req, res, {
    host: '127.0.0.1', port: TEXT_PORT, path: '/v1/chat/completions',
    method: 'POST', accept: 'text/event-stream', defaultType: 'text/event-stream',
    errorMessage: 'llama-server non raggiungibile',
  })
}
