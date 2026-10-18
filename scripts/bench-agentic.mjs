// Palamede — benchmark AGENTICO end-to-end (llama.cpp).
// A differenza di bench-text.mjs (singolo turno, risposta secca), qui il modello
// lavora come agente ReAct: usa strumenti locali (calcolatrice, archivio, cerca),
// attraversa stadi multi-turno (memoria, aggiornamenti) e risolve piani vincolati.
// Punteggio oggettivo, niente giudici LLM (stesso principio dell'evalset testuale).
// Task in scripts/bench-agentic.tasks.json.
// Uso:  node scripts/bench-agentic.mjs [--only id1,id2] [--tasks t1,t2] [--level base|hard|all] [--max-steps N] [--thinking]
// Output: outputs/benchmark-agentic/*.json + summary.json + summary.md

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LLAMA_BUILD = (process.env.PALAMEDE_LLAMA_DIR
  ? process.env.PALAMEDE_LLAMA_DIR
  : ['llama-cpp-b11707', 'llama-cpp-b11457', 'llama-cpp'].map((d) => join(ROOT, 'tools', d)))
  .find((d) => existsSync(join(d, 'llama-server.exe')))
  ?? join(ROOT, 'tools', 'llama-cpp')
const LLAMA_SERVER = join(LLAMA_BUILD, 'llama-server.exe')
// porta dedicata (non :8121 chat, :8122 giudice, :8125 rerank, :8126 wan, :8127 banco testuale)
const PORT = Number(process.env.BENCH_AGENTIC_PORT || 8128)
const TASKS = JSON.parse(readFileSync(join(ROOT, 'scripts', 'bench-agentic.tasks.json'), 'utf8'))

const argv = process.argv.slice(2)
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const ONLY = (argVal('--only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const ONLY_TASKS = (argVal('--tasks') || '').split(',').map((s) => s.trim()).filter(Boolean)
const LEVEL = (argVal('--level') || 'all').toLowerCase()
const MAX_STEPS = Math.max(1, Number(argVal('--max-steps')) || TASKS.maxStepsPerStage || 8)
const THINKING = argv.includes('--thinking')
// --out-dir: destinazione alternativa (relativa alla root), per tenere separate
// le misure thinking-on dagli ufficiali thinking-off.
const OUT_REL = argVal('--out-dir') || 'outputs/benchmark-agentic'
const OUT = join(ROOT, ...OUT_REL.split('/'))
const LOGS = join(OUT, 'logs')
const levelOk = (t) => LEVEL === 'all' || (t.level || 'base') === LEVEL

// Config per modello: stessi file/flag di scripts/bench-text.mjs (fonte per ncmoe/fallback).
const MODELS = [
  { id: 'ornith-9b', name: 'Ornith 1.5 9B · Q4_K_M', file: 'models/ornith-1.5-9b/Ornith-1.5-9B-Q4_K_M.gguf', ngl: 99 },
  { id: 'ornith-9b-q5', name: 'Ornith 1.5 9B · Q5_K_M', file: 'models/ornith-1.5-9b/Ornith-1.5-9B-Q5_K_M.gguf', ngl: 99 },
  { id: 'ornith-35b', name: 'Ornith 1.5 35B-A3B · Q4_K_M', file: 'models/ornith-1.5-35b/Ornith-1.5-35B-Q4_K_M.gguf', ngl: 99, ncmoe: 30, moe: true, fallback: { ncmoe: -1 } },
  { id: 'k2-7b', name: 'K2 Horizon 7B · Q4_K_M', file: 'models/k2-7b/K2-Horizon-7B-Q4_K_M.gguf', ngl: 99 },
  { id: 'k2-36b', name: 'K2 Horizon 36B-A4B MoVA · Q4_K_M', file: 'models/k2-36b/K2-Horizon-MoVA-36B-A4B-Q4_K_M.gguf', ngl: 99, ncmoe: 45, moe: true, mova: true, fallback: { ncmoe: -1 } },
  { id: 'pocket-darwin-180b', name: 'POCKET-Darwin 180B · UD-Q4_K_XL', file: 'models/Pocket-Darwin-180B/POCKET-Darwin-180B-UD-Q4_K_XL-00001-of-00004.gguf', ngl: 99, ncmoe: 44, moe: true, asyncOffload: true, fallback: { ncmoe: -1 } },
  { id: 'bonsai-27b', name: 'Bonsai 27B · Q1_0', file: 'models/bonsai-27b/Bonsai-27B-Q1_0.gguf', ngl: 99 },
  { id: 'lfm-vl-3b', name: 'LFM2.5 VL 3B · Q5_K_XL', file: 'models/lfm/lfm-vl-3b/LFM2.5-VL-3B-Q5_K_XL.gguf', ngl: 99 },
  { id: 'gemma-4-26b', name: 'Gemma 4 26B-A3.8B · IQ3_S', file: 'models/gemma-4-26b/gemma-4-26B-A4B-it-UD-IQ3_S.gguf', ngl: 99, moe: true, fallback: { cpuMoe: true } },
  { id: 'minicpm5-2b', name: 'MiniCPM5 2B · Q4_K_M', file: 'models/minicpm5-2b/MiniCPM5-2B-Q4_K_M.gguf', ngl: 99 },
  { id: 'minicpm-v47-35b', name: 'MiniCPM-V 4.7 35B-A3B · Q4_K_M', file: 'models/minicpm-v47-35b/MiniCPM-V-4_7-35B-A3B-Q4_K_M.gguf', ngl: 99, ncmoe: 30, moe: true, fallback: { ncmoe: -1 } },
  // Nemotron 3.5 Bolt 74B-A9B: esperti diversi per layer (240..496), quindi
  // solo su llama.cpp >= b11707.
  { id: 'nemotron-bolt-74b', name: 'Nemotron 3.5 Bolt 74B-A9B · UD-Q3_K_XL', file: 'models/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-UD-Q3_K_XL.gguf', ngl: 99, ncmoe: 40, moe: true, ot: 'blk\\.[0-9]+\\.ffn_(up_exps|down_exps|gate_inp|exp_probs_b)=CPU', fallback: { ncmoe: -1 } },
  { id: 'nemotron-bolt-74b-q2', name: 'Nemotron 3.5 Bolt 74B-A9B · UD-Q2_K_XL', file: 'models/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-UD-Q2_K_XL.gguf', ngl: 99, ncmoe: 40, moe: true, ot: 'blk\\.[0-9]+\\.ffn_(up_exps|down_exps|gate_inp|exp_probs_b)=CPU', fallback: { ncmoe: -1 } },
  { id: 'qwen38-27b', name: 'Qwen3.8 27B · IQ3_XXS', file: 'models/qwen38-27b/Qwen3.8-27B-GSQ-RCO-IQ3_XXS.gguf', ngl: 99 },
  { id: 'gemma-4-12b', name: 'Gemma 4 12B IT · QAT Q4', file: 'models/Jarvis/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', ngl: 99 },
  { id: 'lfm-24a2b', name: 'LFM2.5 24B-A2B · UD-Q5_K_XL', file: 'models/lfm/lfm-24a2b/LFM2.5-24B-A2B-UD-Q5_K_XL.gguf', ngl: 99, ncmoe: 30, moe: true, fallback: { ncmoe: -1 } },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── server (stesso schema di bench-text.mjs) ──────────────────────────────

function offloadArgs(cfg) {
  const a = []
  // `ot`: solo tensori per-esperto in CPU (Nemotron shared expert in VRAM)
  if (cfg.ot) a.push('-ot', cfg.ot)
  else if (cfg.cpuMoe) a.push('--cpu-moe')
  else if (cfg.ncmoe === -1) a.push('--cpu-moe')
  else if (cfg.ncmoe > 0) a.push('--n-cpu-moe', String(cfg.ncmoe))
  if (cfg.mova && cfg.movaCpu) a.push('-ot', 'attn_v_exps=CPU')
  if (cfg.asyncOffload) a.push('--no-op-offload')
  return a
}

function serverArgs(cfg) {
  return ['-m', join(ROOT, cfg.file), '--host', '127.0.0.1', '--port', String(PORT),
    '-c', '8192', '-ngl', String(cfg.ngl ?? 99), '--flash-attn', 'on', '--no-warmup',
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0',
    '--reasoning', THINKING ? 'on' : 'off', ...offloadArgs(cfg)]
}

async function health(timeoutMs = 2500) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return (await r.json()).status === 'ok'
  } catch {}
  return false
}

async function startServer(cfg, tag) {
  const logFile = join(LOGS, `${cfg.id}${tag}.log`)
  writeFileSync(logFile, `--- llama-server ${JSON.stringify(serverArgs(cfg))} ---\n`)
  const proc = spawn(LLAMA_SERVER, serverArgs(cfg), { cwd: ROOT, windowsHide: true })
  proc.stdout.on('data', (d) => appendFileSync(logFile, d))
  proc.stderr.on('data', (d) => appendFileSync(logFile, d))
  let dead = false
  proc.on('exit', () => { dead = true })
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (dead) return { ok: false, proc: null, err: 'server uscito durante il load (OOM?)' }
    if (await health(2000)) return { ok: true, proc, loadMs: Date.now() - (deadline - 300_000) }
    await sleep(800)
  }
  try { proc.kill() } catch {}
  return { ok: false, proc: null, err: 'timeout load 300s' }
}

async function stopServer(proc) {
  if (!proc) return
  try { proc.kill() } catch {}
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (!(await health(1000))) break
    await sleep(500)
  }
  await sleep(3000)
}

async function chat(messages, maxTokens = 512) {
  // Con --thinking il ragionamento mangia token PRIMA della risposta: misurati
  // fino a ~1800 caratteri (k2-36b) con risposta finale vuota a 512 token.
  // Sotto il soffitto i punteggi sarebbero tutti zero (fasulli), quindi si alza.
  const limit = THINKING ? 2048 : maxTokens
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0, top_p: 1, seed: 42, max_tokens: limit, stream: false }),
    signal: AbortSignal.timeout(180_000),
  })
  const j = await r.json()
  const msg = j.choices?.[0]?.message || {}
  return ((msg.content || '').trim() || (msg.reasoning_content || '').trim())
}

// ── strumenti locali (deterministici, niente rete) ────────────────────────

const TOOL_DESC = {
  calcolatrice: 'calcolatrice: espressioni con SOLO cifre e + - * / ( ) . %, es. {\"strumento\": \"calcolatrice\", \"ingresso\": \"240*0.85\"}. Niente parole o simboli di valuta: se li usi risponde con un errore.',
  archivio: 'archivio: comandi "leggi <chiave>", "scrivi <chiave> = <valore>", "elenca". Le chiavi sono minuscole, es. {\"strumento\": \"archivio\", \"ingresso\": \"leggi mele\"}.',
  cerca: 'cerca: una o più parole chiave, es. {\"strumento\": \"cerca\", \"ingresso\": \"manuale stampa\"}. Restituisce i 2 documenti più pertinenti.',
}

function toolCalcolatrice(input) {
  const expr = String(input || '').replace(/\s+/g, '').replace(/\^/g, '**').replace(/,/g, '.')
  if (!expr || /[^0-9+\-*/().%]/.test(expr)) {
    return { ok: false, text: 'ERRORE: la calcolatrice accetta solo cifre e operatori + - * / ( ) . % (es. 240*15/100). Riformula senza parole.' }
  }
  try {
    const v = Function(`"use strict"; return (${expr})`)()
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, text: 'ERRORE: espressione non valida, riprova.' }
    const out = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
    return { ok: true, text: `RISULTATO: ${out}` }
  } catch {
    return { ok: false, text: 'ERRORE: espressione non valida, riprova.' }
  }
}

function toolArchivio(store, input) {
  const s = String(input || '').trim()
  let m = s.match(/^leggi\s+(.+)$/i)
  if (m) {
    const k = m[1].trim().toLowerCase()
    return { ok: k in store, text: k in store ? `ARCHIVIO ${k} = ${store[k]}` : `ERRORE: chiave "${k}" assente. Usa "elenca" per vedere le chiavi.` }
  }
  m = s.match(/^scrivi\s+(.+?)\s*=\s*(.+)$/i)
  if (m) {
    const k = m[1].trim().toLowerCase()
    store[k] = m[2].trim()
    return { ok: true, text: `ARCHIVIO: salvato ${k} = ${store[k]}` }
  }
  if (/^elenca$/i.test(s)) {
    const keys = Object.keys(store)
    return { ok: true, text: keys.length ? `ARCHIVIO chiavi: ${keys.join(', ')}` : 'ARCHIVIO vuoto.' }
  }
  return { ok: false, text: 'ERRORE: comandi validi: "leggi <chiave>", "scrivi <chiave> = <valore>", "elenca".' }
}

const STOPWORDS = new Set('di a da in con su per tra fra il lo la i gli le un uno una che che non si come dove quando quale quali quanto quanta al del allo allo della dello della nei negli nelle degli dello sul sullo sulla'.split(' '))
function toolCerca(corpus, input) {
  const words = String(input || '').toLowerCase().split(/[^a-zà-ÿ0-9]+/i).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  if (!words.length) return { ok: false, text: 'ERRORE: dammi almeno una parola chiave (min 3 lettere).' }
  const scored = (corpus || []).map((d) => {
    const low = d.testo.toLowerCase()
    const hit = words.filter((w) => low.includes(w)).length
    return { d, hit }
  }).filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, 2)
  if (!scored.length) return { ok: true, text: `Nessun documento trovato per "${input}". Prova altre parole.` }
  return { ok: true, text: scored.map((x) => `— [${x.d.id}]: ${x.d.testo.slice(0, 380)}`).join('\n') }
}

// ── protocollo ReAct ─────────────────────────────────────────────────────

const SYSTEM = `Sei un agente che risolve compiti usando strumenti.
Rispondi SEMPRE in uno di questi due modi:
1. per usare uno strumento, scrivi un blocco JSON da solo su righe proprie:
{"strumento": "<nome>", "ingresso": "<testo>"}
2. quando hai la risposta definitiva, scrivila dopo la riga:
FINALE: <la tua risposta>
Puoi scrivere un breve ragionamento prima del JSON o di FINALE. Una sola azione per messaggio.`

function parseAction(text) {
  const fenced = text.match(/```(?:json)?\s*(\{[^{}]*\})\s*```/i)
  const raw = fenced ? fenced[1] : (text.match(/\{[^{}]*"(strumento|tool|azione|action)"[^{}]*\}/) || [])[0]
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    const tool = o.strumento || o.tool || o.azione || o.action
    const input = o.ingresso ?? o.input ?? o.testo ?? o.argomento ?? o.args ?? ''
    if (typeof tool !== 'string') return { error: 'azione senza nome strumento' }
    return { tool: tool.trim().toLowerCase(), input: String(input) }
  } catch {
    return { error: 'JSON non valido' }
  }
}

function parseFinal(text) {
  const m = text.match(/^\s*(FINALE|RISPOSTA\s+FINALE)\s*:([\s\S]*)$/im)
  return m ? m[2].trim() : null
}

// ── valutatori ───────────────────────────────────────────────────────────

function numFrom(text) {
  const t = String(text || '').replace(/\.(?=\d{3}\b)/g, '')
  const m = t.match(/(?:answer|risposta|risultato|totale|vale|paga|=|:)\s*(-?\d+(?:[.,]\d+)?)/i)
  if (m) return Number(m[1].replace(',', '.'))
  const nums = t.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g)
  return nums && nums.length ? Number(nums[nums.length - 1]) : null
}

function numLoose(v) {
  const m = String(v || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : NaN
}

const CUSTOM = {
  magazzino(final, run) {
    const mele = numLoose(run.store.mele), pere = numLoose(run.store.pere)
    const stateOk = mele === 67 && pere === 7
    const low = String(final || '').toLowerCase()
    const textOk = low.includes('67') && /(^|\D)7(\D|$)/.test(low)
    const ok = stateOk && textOk
    return { ok, score: ok ? 1 : 0, got: `archivio mele=${run.store.mele} pere=${run.store.pere} | testo:${ok ? 'ok' : 'manca 67/7'}` }
  },
  scadenze(final, run) {
    const f2 = numLoose(run.store.fattura2)
    const acc2 = numLoose(run.store.acconto2)
    const stateOk = Math.abs(f2 - 765) < 0.01 && acc2 === 300
    const got = numFrom(final)
    const textOk = got !== null && Math.abs(got - 1165) < 0.01
    const ok = stateOk && textOk
    return { ok, score: ok ? 1 : 0, got: `archivio fattura2=${run.store.fattura2} acconto2=${run.store.acconto2} | totale:${got ?? '—'}` }
  },
  riunioni(final) {
    const lines = String(final || '').split('\n').map((l) => l.trim()).filter(Boolean)
    const slots = []
    for (const l of lines) {
      const m = l.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*[-–:]\s*([A-Za-zÀ-ÿ]+)/)
      if (!m) return { ok: false, score: 0, got: `riga non valida: "${l.slice(0, 40)}"` }
      slots.push({ h: Number(m[1]), name: m[3].toLowerCase() })
    }
    const names = slots.map((s) => s.name).sort().join(',')
    if (slots.length !== 3 || names !== 'bianchi,rossi,verdi') {
      return { ok: false, score: 0, got: `nomi/ore: ${slots.map((s) => `${s.h}:${s.name}`).join(' ')}` }
    }
    const by = Object.fromEntries(slots.map((s) => [s.name, s.h]))
    const ok = by.rossi >= 9 && by.rossi <= 10 && by.bianchi >= 10 && by.bianchi <= 12
      && by.verdi >= 11 && by.verdi <= 12
      && new Set(slots.map((s) => s.h)).size === 3
      && slots.every((s) => s.h >= 9 && s.h <= 12)
    return { ok, score: ok ? 1 : 0, got: slots.map((s) => `${s.h}:${s.name}`).join(' ') }
  },
  budget(final) { return scoreSubset(final, { A: 45, B: 30, C: 25, D: 20 }, 70) },
  zaino(final, run, sc) { return scoreSubset(final, sc.prices, sc.cap) },
  assegnazione(final, run, sc) {
    const attesi = sc.attesi || {}
    const lines = String(final || '').split('\n').map((l) => l.trim()).filter(Boolean)
    const got = {}
    for (const l of lines) {
      const m = l.match(/^(\d+)\s*[-–:]\s*([A-Za-zÀ-ÿ]+)/)
      if (!m) return { ok: false, score: 0, got: `riga non valida: "${l.slice(0, 40)}"` }
      got[m[1]] = m[2].toLowerCase()
    }
    const keys = Object.keys(attesi).sort().join(',')
    const ok = Object.keys(got).sort().join(',') === keys && Object.entries(attesi).every(([k, v]) => got[k] === String(v).toLowerCase())
    return { ok, score: ok ? 1 : 0, got: Object.entries(got).map(([k, v]) => `${k}:${v}`).join(' ') || '—' }
  },
  segnala(final, run, sc) {
    const low = String(final || '').toLowerCase()
    const hitR = (sc.richiesti || []).map((s) => String(s).toLowerCase())
    const hitS = (sc.segnali || []).map((s) => String(s).toLowerCase())
    const okR = hitR.every((s) => low.includes(s))
    const okS = hitS.some((s) => low.includes(s))
    const ok = okR && okS
    return { ok, score: ok ? 1 : 0, got: `fatti:${hitR.map((s) => `${s}:${low.includes(s) ? 'Y' : 'N'}`).join(' ')} segnale:${okS ? 'Y' : 'N'}` }
  },
  formato(final) {
    const okCities = new Set('roma parigi berlino madrid lisbona vienna praga varsavia amsterdam bruxelles dublino stoccolma oslo helsinki atene budapest zagabria lubiana bratislava sofia tallinn riga vilnius nicosia valletta'.split(' '))
    const lines = String(final || '').split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length !== 3) return { ok: false, score: 0, got: `${lines.length} righe` }
    for (const l of lines) {
      const m = l.match(/^CITTA:\s*(.+)$/i)
      if (!m || !okCities.has(m[1].trim().toLowerCase())) return { ok: false, score: 0, got: `riga: "${l.slice(0, 40)}"` }
    }
    return { ok: true, score: 1, got: lines.join(' | ') }
  },
}

function scoreTask(task, final, run) {
  const sc = task.score || {}
  const low = String(final || '').toLowerCase()
  if (sc.not && sc.not.some((s) => low.includes(String(s).toLowerCase()))) {
    return { ok: false, score: 0, got: `vietato presente: ${(final || '').slice(0, 120)}` }
  }
  if (sc.kind === 'custom') return CUSTOM[sc.fn](final, run, sc)
  if (sc.kind === 'number') {
    const got = numFrom(final)
    const ok = got !== null && Math.abs(got - Number(sc.answer)) <= (sc.tol ?? 1e-6)
    return { ok, score: ok ? 1 : 0, got: got === null ? '—' : String(got) }
  }
  if (sc.kind === 'exact-ci') {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const ok = norm(final) === norm(sc.answer)
    return { ok, score: ok ? 1 : 0, got: (final || '').slice(0, 120) }
  }
  if (sc.kind === 'contains-all' || sc.kind === 'contains-any') {
    const subs = sc.answer.map((s) => String(s).toLowerCase())
    const hit = subs.map((s) => low.includes(s))
    const ok = sc.kind === 'contains-any' ? hit.some(Boolean) : hit.every(Boolean)
    return { ok, score: ok ? 1 : 0, got: subs.map((s, i) => `${s}:${hit[i] ? 'Y' : 'N'}`).join(' ') }
  }
  return { ok: false, score: 0, got: 'valutatore sconosciuto' }
}

function scoreSubset(final, prices, cap) {
  const letters = [...new Set((String(final || '').toUpperCase().match(/\b[A-E]\b/g) || []))]
  const total = letters.reduce((a, l) => a + (prices[l] || 0), 0)
  if (!letters.length || total > cap) return { ok: false, score: 0, got: `${letters.join('+') || '—'}=${total}` }
  return { ok: total === cap, score: Math.round((total / cap) * 100) / 100, got: `${letters.join('+')}=${total}` }
}

// ── esecuzione task ──────────────────────────────────────────────────────

function toolsBlock(task) {
  if (!task.tools || !task.tools.length) return 'Strumenti disponibili: nessuno. Rispondi direttamente con FINALE: <risposta>.\n\n'
  return `Strumenti disponibili:\n${task.tools.map((t) => `- ${TOOL_DESC[t]}`).join('\n')}\n\n`
}

async function runTask(task) {
  const store = { ...(task.seed || {}) }
  const run = { store, steps: 0, toolCalls: {}, toolErrors: 0, formatErrors: 0, trace: [] }
  const messages = [{ role: 'system', content: SYSTEM }]
  let final = ''
  const pushTrace = (role, text) => {
    run.trace.push({ role, text: String(text).slice(0, 600) })
  }
  for (const stage of task.stages) {
    messages.push({ role: 'user', content: toolsBlock(task) + 'Compito: ' + stage })
    pushTrace('user', stage)
    let stageDone = false
    for (let step = 0; step < MAX_STEPS && !stageDone; step++) {
      let reply = ''
      try {
        reply = await chat(messages)
      } catch (e) {
        run.trace.push({ role: 'error', text: String(e).slice(0, 200) })
        break
      }
      run.steps++
      pushTrace('assistant', reply)
      const fin = parseFinal(reply)
      if (fin !== null) { final = fin; stageDone = true; break }
      const act = parseAction(reply)
      if (!act) {
        run.formatErrors++
        if (run.formatErrors > 2) { final = reply; stageDone = true; break }
        const hint = 'FORMATO NON VALIDO: rispondi o con {"strumento": "<nome>", "ingresso": "<testo>"} o con FINALE: <risposta>. Riprova.'
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: hint })
        continue
      }
      if (act.error || !TOOL_DESC[act.tool] || !(task.tools || []).includes(act.tool)) {
        run.toolErrors++
        const hint = `ERRORE: strumento "${act.tool || '?'}" non disponibile. Strumenti: ${(task.tools || []).join(', ') || 'nessuno'}.`
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: hint })
        pushTrace('user', hint)
        continue
      }
      run.toolCalls[act.tool] = (run.toolCalls[act.tool] || 0) + 1
      let res
      if (act.tool === 'calcolatrice') res = toolCalcolatrice(act.input)
      else if (act.tool === 'archivio') res = toolArchivio(store, act.input)
      else res = toolCerca(task.corpus, act.input)
      if (!res.ok) run.toolErrors++
      const obs = `OSSERVAZIONE (${act.tool}): ${res.text}`
      messages.push({ role: 'assistant', content: reply }, { role: 'user', content: obs })
      pushTrace('user', obs)
    }
    if (!stageDone) final = ''
  }
  // vincoli mustUse / minCalls
  let verdict = scoreTask(task, final, run)
  const missing = (task.mustUse || []).filter((t) => !(run.toolCalls[t] > 0))
  if (missing.length) verdict = { ok: false, score: 0, got: `${verdict.got} | MAI USATO: ${missing.join(',')}` }
  for (const [t, n] of Object.entries(task.minCalls || {})) {
    if ((run.toolCalls[t] || 0) < n) verdict = { ok: false, score: 0, got: `${verdict.got} | ${t} usato ${run.toolCalls[t] || 0}<${n}` }
  }
  return {
    id: task.id, category: task.category, ok: verdict.ok, score: verdict.score, got: verdict.got,
    steps: run.steps, toolCalls: run.toolCalls, toolErrors: run.toolErrors,
    formatErrors: run.formatErrors, recovered: run.toolErrors > 0 && verdict.ok,
    final: String(final).slice(0, 300), trace: run.trace,
  }
}

// ── modello ──────────────────────────────────────────────────────────────

async function benchModel(cfg, taskList) {
  console.log(`\n=== ${cfg.id} — ${cfg.name} ===`)
  const result = { id: cfg.id, name: cfg.name, file: cfg.file, thinking: THINKING, maxSteps: MAX_STEPS, level: LEVEL, ts: new Date().toISOString() }
  console.log('  [server] avvio llama-server ...')
  let s = await startServer(cfg, '')
  let usedCfg = { ...cfg }
  if (!s.ok && cfg.fallback) {
    console.log(`  [server] load fallito (${s.err}), provo fallback ${JSON.stringify(cfg.fallback)}`)
    usedCfg = { ...cfg, ...cfg.fallback }
    s = await startServer(usedCfg, '.fallback')
  }
  if (!s.ok) {
    console.log(`  [server] FALLITO: ${s.err}`)
    result.error = s.err
    result.tasks = []
  } else {
    result.loadMs = s.loadMs
    result.tasks = []
    for (const t of taskList) {
      process.stdout.write(`  [${t.id}] `)
      const r = await runTask(t)
      result.tasks.push(r)
      console.log(`${r.ok ? 'OK' : 'X'} score=${r.score} passi=${r.steps} tool=${JSON.stringify(r.toolCalls)} err=${r.toolErrors}/${r.formatErrors} :: ${String(r.got).slice(0, 90)}`)
    }
    await stopServer(s.proc)
  }
  writeFileSync(join(OUT, `${cfg.id}.json`), JSON.stringify(result, null, 2))
  return result
}

// ── riepilogo ────────────────────────────────────────────────────────────

function taskLevel(id, taskList) {
  const t = taskList.find((x) => x.id === id)
  return t ? (t.level || 'base') : 'base'
}

function summarize(result, taskList) {
  const tasks = result.tasks || []
  const byCat = {}
  for (const t of tasks) {
    byCat[t.category] = byCat[t.category] || { score: 0, total: 0 }
    byCat[t.category].total++
    byCat[t.category].score += t.score
  }
  const cats = {}
  for (const [c, v] of Object.entries(byCat)) cats[c] = v.total ? Math.round((v.score / v.total) * 100) / 100 : null
  const total = tasks.length
  const sum = tasks.reduce((a, t) => a + t.score, 0)
  const split = (level) => {
    const sel = tasks.filter((t) => (taskLevel(t.id, taskList)) === level)
    if (!sel.length) return null
    return Math.round((sel.reduce((a, t) => a + t.score, 0) / sel.length) * 1000) / 1000
  }
  return {
    id: result.id, name: result.name,
    success: total ? sum / total : null,
    successBase: split('base'), successHard: split('hard'),
    solved: tasks.filter((t) => t.ok).length, total: taskList.length,
    byCategory: cats,
    avgSteps: total ? Math.round((tasks.reduce((a, t) => a + t.steps, 0) / total) * 10) / 10 : null,
    toolErrors: tasks.reduce((a, t) => a + t.toolErrors, 0),
    formatErrors: tasks.reduce((a, t) => a + t.formatErrors, 0),
    recovered: tasks.filter((t) => t.recovered).length,
    loadMs: result.loadMs ?? null, error: result.error || null,
  }
}

function buildSummary(results, taskList) {
  const categories = [...new Set(taskList.map((t) => t.category))]
  const rows = results.map((r) => summarize(r, taskList))
  const bySuccess = [...rows].filter((r) => r.success != null).sort((a, b) => b.success - a.success)
    .map((r, i) => ({ pos: i + 1, id: r.id, val: r.success }))
  return {
    generatedAt: new Date().toISOString(),
    hardware: 'RTX 5060 Ti 16GB',
    taskCount: taskList.length, categories, thinking: THINKING, maxSteps: MAX_STEPS,
    levels: { base: taskList.filter((t) => (t.level || 'base') === 'base').length, hard: taskList.filter((t) => t.level === 'hard').length },
    method: {
      protocol: 'ReAct: {"strumento","ingresso"} o FINALE: · max ' + MAX_STEPS + ' passi/stadio · temperatura 0',
      tools: 'calcolatrice (solo cifre/operatori) · archivio (leggi/scrivi/elenca) · cerca (2 doc pertinenti)',
      scoring: 'oggettivo per task (numero esatto, contains, validatori; budget = punteggio parziale)',
    },
    rows, bySuccess,
  }
}

function writeMarkdown(sum) {
  const name = (id) => sum.rows.find((r) => r.id === id)?.name || id
  const f = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d))
  let md = `# Benchmark agentico — Palamede\n\n`
  md += `Generato: ${sum.generatedAt} · GPU: ${sum.hardware} · ${sum.taskCount} task · thinking ${sum.thinking ? 'on' : 'off'}\n\n`
  md += `Protocollo ReAct (max ${sum.maxSteps} passi/stadio, temperatura 0). Successo = media punteggi task (budget = parziale).\n\n`
  md += `| Modello | Successo | Base | Difficili | Risolti | Passi medi | Errori tool | Errori formato | Recuperi |\n|---|---|---|---|---|---|---|---|---|\n`
  for (const r of sum.rows) {
    const pc = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%')
    md += `| ${r.name} | ${pc(r.success)} | ${pc(r.successBase)} | ${pc(r.successHard)} | ${r.solved}/${r.total} | ${f(r.avgSteps, 1)} | ${r.toolErrors} | ${r.formatErrors} | ${r.recovered} |\n`
  }
  md += `\n## Per categoria (media punteggi)\n\n| Modello | ${sum.categories.join(' | ')} |\n|---|${sum.categories.map(() => '---').join('|')}|\n`
  for (const r of sum.rows) {
    md += `| ${r.name} | ${sum.categories.map((c) => (r.byCategory?.[c] == null ? '—' : (r.byCategory[c] * 100).toFixed(0) + '%')).join(' | ')} |\n`
  }
  md += `\n## Classifica\n\n| # | Modello | Successo |\n|---|---|---|\n`
  for (const r of sum.bySuccess) md += `| ${r.pos} | ${name(r.id)} | ${(r.val * 100).toFixed(1)}% |\n`
  writeFileSync(join(OUT, 'summary.md'), md)
}

async function main() {
  if (!existsSync(LLAMA_SERVER)) throw new Error(`manca ${LLAMA_SERVER}`)
  mkdirSync(LOGS, { recursive: true })
  const taskList = TASKS.tasks.filter((t) => levelOk(t) && (!ONLY_TASKS.length || ONLY_TASKS.includes(t.id)))
  const list = MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))
  console.log(`Benchmark agentico: ${list.length} modelli × ${taskList.length} task (livello ${LEVEL}, thinking ${THINKING ? 'on' : 'off'}, max ${MAX_STEPS} passi/stadio) → ${OUT_REL}`)
  const results = []
  for (const cfg of list) {
    if (!existsSync(join(ROOT, cfg.file))) { console.log(`SKIP ${cfg.id}: manca ${cfg.file}`); continue }
    results.push(await benchModel(cfg, taskList))
  }
  const map = new Map()
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith('.json') || f === 'summary.json') continue
    try { const r = JSON.parse(readFileSync(join(OUT, f), 'utf8')); if (r.id) map.set(r.id, r) } catch {}
  }
  for (const r of results) map.set(r.id, r)
  const merged = [...map.values()]
  const summary = buildSummary(merged, TASKS.tasks)
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  writeMarkdown(summary)
  console.log(`\nFatto. Risultati in outputs/benchmark-agentic/ (summary.json, summary.md)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
