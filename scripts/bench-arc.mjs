// Palamede — benchmark ARC-AGI-1 (ragionamento fluido su griglie).
// Sottoinsieme di 20 task TRAINING vendorizzati in scripts/bench-arc.tasks.json
// (mai il set evaluation, per fairness; fonte+licenza nel file).
// Protocollo: demo in/out nel prompt, il modello produce la griglia di output
// per ogni test input, 2 tentativi (lo standard ARC ne prevede 3; 2 per costi).
// Punteggio: esattezza (tutte le celle di tutti i test) + accuratezza celle.
// Uso:  node scripts/bench-arc.mjs [--only id1,id2] [--tasks t1,t2] [--thinking]
// Output: outputs/benchmark-arc/*.json + summary.json + summary.md

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LLAMA_BUILD = (process.env.PALAMEDE_LLAMA_DIR
  ? process.env.PALAMEDE_LLAMA_DIR
  : ['llama-cpp-b11457', 'llama-cpp'].map((d) => join(ROOT, 'tools', d)))
  .find((d) => existsSync(join(d, 'llama-server.exe')))
  ?? join(ROOT, 'tools', 'llama-cpp')
const LLAMA_SERVER = join(LLAMA_BUILD, 'llama-server.exe')
// porta dedicata (non :8121 chat, :8122 giudice, :8125 rerank, :8126 wan, :8127 testuale, :8128 agentico)
const PORT = Number(process.env.BENCH_ARC_PORT || 8129)
const OUT = join(ROOT, 'outputs', 'benchmark-arc')
const LOGS = join(OUT, 'logs')
const BANK = JSON.parse(readFileSync(join(ROOT, 'scripts', 'bench-arc.tasks.json'), 'utf8'))
const ATTEMPTS = 2

const argv = process.argv.slice(2)
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const ONLY = (argVal('--only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const ONLY_TASKS = (argVal('--tasks') || '').split(',').map((s) => s.trim()).filter(Boolean)
const THINKING = argv.includes('--thinking')

// Stessi file/flag di scripts/bench-text.mjs (fonte per ncmoe/fallback).
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
  { id: 'qwen38-27b', name: 'Qwen3.8 27B · IQ3_XXS', file: 'models/qwen38-27b/Qwen3.8-27B-GSQ-RCO-IQ3_XXS.gguf', ngl: 99 },
  { id: 'gemma-4-12b', name: 'Gemma 4 12B IT · QAT Q4', file: 'models/Jarvis/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', ngl: 99 },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── server ───────────────────────────────────────────────────────────────

function offloadArgs(cfg) {
  const a = []
  if (cfg.cpuMoe) a.push('--cpu-moe')
  else if (cfg.ncmoe === -1) a.push('--cpu-moe')
  else if (cfg.ncmoe > 0) a.push('--n-cpu-moe', String(cfg.ncmoe))
  if (cfg.mova && cfg.movaCpu) a.push('-ot', 'attn_v_exps=CPU')
  if (cfg.asyncOffload) a.push('--no-op-offload')
  return a
}

function serverArgs(cfg) {
  // -c 4096: i prompt ARC sono <=6000 char (~2000 token); contesti larghi
  // rallentano solo prefill e KV (misurato: Darwin impiega 200+s a 16k).
  return ['-m', join(ROOT, cfg.file), '--host', '127.0.0.1', '--port', String(PORT),
    '-c', '4096', '-ngl', String(cfg.ngl ?? 99), '--flash-attn', 'on', '--no-warmup',
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
  const t0 = Date.now()
  const deadline = t0 + 300_000
  while (Date.now() < deadline) {
    if (dead) return { ok: false, proc: null, err: 'server uscito durante il load (OOM?)' }
    if (await health(2000)) return { ok: true, proc, loadMs: Date.now() - t0 }
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

async function chat(messages, maxTokens = 4096) {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0, top_p: 1, seed: 42, max_tokens: maxTokens, stream: false }),
    // Darwin impiega 200+s a task: timeout largo, vale per tutti.
    signal: AbortSignal.timeout(600_000),
  })
  const j = await r.json()
  const msg = j.choices?.[0]?.message || {}
  return ((msg.content || '').trim() || (msg.reasoning_content || '').trim())
}

// ── griglie ──────────────────────────────────────────────────────────────

const gridText = (g) => g.map((r) => r.join(' ')).join('\n')

function buildPrompt(task) {
  const parts = ['Osserva gli esempi di trasformazione (in -> out) e applica la STESSA regola al test.',
    'Le griglie usano cifre 0-9 separate da spazi. Rispondi con ESATTAMENTE la griglia di output del test, una riga per riga, solo cifre e spazi. Niente spiegazioni.']
  task.train.forEach((p, i) => {
    parts.push(`Esempio ${i + 1} in:\n${gridText(p[0])}`)
    parts.push(`Esempio ${i + 1} out:\n${gridText(p[1])}`)
  })
  task.test.forEach((p, i) => {
    parts.push(`Test ${i + 1} in:\n${gridText(p[0])}`)
  })
  return parts.join('\n')
}

/** Estrae la griglia dalla risposta: righe di sole cifre (spazi ok). */
function parseGrid(text) {
  const rows = []
  for (const line of String(text || '').split('\n')) {
    const cells = line.trim().split(/\s+/).filter(Boolean)
    if (cells.length && cells.every((c) => /^[0-9]$/.test(c))) rows.push(cells.map(Number))
  }
  if (!rows.length) return null
  const w = rows[0].length
  if (!rows.every((r) => r.length === w)) return null
  return rows
}

function gridScore(expected, got) {
  if (!got) return { exact: false, cells: 0, total: expected.flat().length }
  const total = expected.flat().length
  if (got.length !== expected.length || got[0].length !== expected[0].length) {
    return { exact: false, cells: 0, total, shapeMismatch: [got.length, got[0].length] }
  }
  let cells = 0
  for (let r = 0; r < expected.length; r++) {
    for (let c = 0; c < expected[0].length; c++) {
      if (got[r][c] === expected[r][c]) cells++
    }
  }
  return { exact: cells === total, cells, total }
}

// ── esecuzione ───────────────────────────────────────────────────────────

async function runArcTask(task) {
  const prompt = buildPrompt(task)
  const messages = [
    { role: 'system', content: 'Sei un solutore di puzzle logici su griglie. VIETATO ragionare ad alta voce, spiegare o commentare: emetti SOLO le righe della griglia. Qualsiasi altro testo annulla la risposta.' },
    { role: 'user', content: prompt },
  ]
  const attempts = []
  let solved = false
  // un tentativo = una griglia per OGNI test input; il task è risolto solo se
  // TUTTI i test sono esatti (regola ARC).
  for (let a = 0; a < ATTEMPTS && !solved; a++) {
    let reply = ''
    try {
      reply = await chat(messages)
    } catch (e) {
      attempts.push({ error: String(e).slice(0, 120) })
      break
    }
    const multi = splitMultiTest(reply, task.test.length)
    const perTest = task.test.map((t, i) => gridScore(t[1], multi[i] || null))
    const cells = perTest.reduce((x, s) => x + s.cells, 0)
    const total = perTest.reduce((x, s) => x + s.total, 0)
    const ok = perTest.every((s) => s.exact)
    attempts.push({ reply: reply.slice(0, 800), exact: ok, cells, total })
    if (ok) { solved = true; break }
    messages.push(
      { role: 'assistant', content: reply },
      { role: 'user', content: 'Sbagliato. Ristudia gli esempi e riprova: rispondi con ESATTAMENTE la griglia di output, solo cifre e spazi.' },
    )
  }
  const best = attempts.reduce((b, x) => Math.max(b, (x.cells || 0) / Math.max(1, x.total || 1)), 0)
  const last = attempts.length ? attempts[attempts.length - 1] : null
  return {
    id: task.id, ok: solved, score: solved ? 1 : 0,
    cellAcc: Math.round(best * 1000) / 1000,
    attempts: attempts.length,
    got: last && last.reply ? last.reply.slice(0, 200) : (last && last.error ? 'ERR ' + last.error : '—'),
  }
}

/** Separa risposte multi-test: blocchi di righe-cifre divisi da righe vuote/testo. */
function splitMultiTest(reply, n) {
  if (n <= 1) return [parseGrid(reply)]
  const blocks = []
  let cur = []
  for (const line of String(reply || '').split('\n')) {
    const cells = line.trim().split(/\s+/).filter(Boolean)
    if (cells.length && cells.every((c) => /^[0-9]$/.test(c))) cur.push(cells.map(Number))
    else if (cur.length) { blocks.push(cur); cur = [] }
  }
  if (cur.length) blocks.push(cur)
  return blocks
}

async function benchModel(cfg, taskList) {
  console.log(`\n=== ${cfg.id} — ${cfg.name} ===`)
  const result = { id: cfg.id, name: cfg.name, file: cfg.file, thinking: THINKING, attempts: ATTEMPTS, ts: new Date().toISOString() }
  console.log('  [server] avvio llama-server ...')
  let s = await startServer(cfg, '')
  if (!s.ok && cfg.fallback) {
    console.log(`  [server] load fallito (${s.err}), provo fallback ${JSON.stringify(cfg.fallback)}`)
    const usedCfg = { ...cfg, ...cfg.fallback }
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
      const r = await runArcTask(t)
      result.tasks.push(r)
      console.log(`${r.ok ? 'OK' : 'X'} celle=${(r.cellAcc * 100).toFixed(0)}% tentativi=${r.attempts}`)
    }
    await stopServer(s.proc)
  }
  writeFileSync(join(OUT, `${cfg.id}.json`), JSON.stringify(result, null, 2))
  return result
}

// ── riepilogo ────────────────────────────────────────────────────────────

function buildSummary(results, taskList) {
  const rows = results.map((r) => {
    const tasks = r.tasks || []
    const solved = tasks.filter((t) => t.ok).length
    const cellAcc = tasks.length ? tasks.reduce((a, t) => a + (t.cellAcc || 0), 0) / tasks.length : null
    return {
      id: r.id, name: r.name,
      solved, total: taskList.length,
      exact: tasks.length ? solved / tasks.length : null,
      cellAcc: cellAcc == null ? null : Math.round(cellAcc * 1000) / 1000,
      loadMs: r.loadMs ?? null, error: r.error || null,
    }
  })
  const byExact = [...rows].filter((r) => r.exact != null).sort((a, b) => b.exact - a.exact)
    .map((r, i) => ({ pos: i + 1, id: r.id, val: r.exact }))
  return {
    generatedAt: new Date().toISOString(),
    hardware: 'RTX 5060 Ti 16GB',
    taskCount: taskList.length, thinking: THINKING, attempts: ATTEMPTS,
    source: 'ARC-AGI-1 training subset (20 task, Apache-2.0 fchollet/ARC-AGI)',
    method: {
      protocol: `demo in/out nel prompt, ${ATTEMPTS} tentativi per task, temperatura 0`,
      scoring: 'esatto = tutte le celle di tutti i test · secondaria = accuratezza celle',
    },
    rows, byExact,
  }
}

function writeMarkdown(sum) {
  let md = `# Benchmark ARC-AGI — Palamede\n\n`
  md += `Generato: ${sum.generatedAt} · GPU: ${sum.hardware} · ${sum.taskCount} task · ${sum.attempts} tentativi · thinking ${sum.thinking ? 'on' : 'off'}\n\n`
  md += `Sottoinsieme training ARC-AGI-1 (Apache-2.0). Esatto = tutte le celle giuste su tutti i test del task.\n\n`
  md += `| Modello | Esatte | Accuratezza celle | Load s |\n|---|---|---|---|\n`
  for (const r of sum.rows) {
    md += `| ${r.name} | ${r.exact == null ? '—' : `${r.solved}/${r.total} (${(r.exact * 100).toFixed(0)}%)`} | ${r.cellAcc == null ? '—' : (r.cellAcc * 100).toFixed(1) + '%'} | ${r.loadMs ? (r.loadMs / 1000).toFixed(1) : '—'} |\n`
  }
  md += `\n## Classifica (task esatti)\n\n| # | Modello | Esatte |\n|---|---|---|\n`
  for (const r of sum.byExact) md += `| ${r.pos} | ${sum.rows.find((x) => x.id === r.id)?.name || r.id} | ${(r.val * 100).toFixed(0)}% |\n`
  writeFileSync(join(OUT, 'summary.md'), md)
}

async function main() {
  if (!existsSync(LLAMA_SERVER)) throw new Error(`manca ${LLAMA_SERVER}`)
  mkdirSync(LOGS, { recursive: true })
  const taskList = BANK.tasks.filter((t) => !ONLY_TASKS.length || ONLY_TASKS.includes(t.id))
  const list = MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))
  console.log(`Benchmark ARC-AGI: ${list.length} modelli × ${taskList.length} task (${ATTEMPTS} tentativi, thinking ${THINKING ? 'on' : 'off'})`)
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
  const summary = buildSummary([...map.values()], BANK.tasks)
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  writeMarkdown(summary)
  console.log(`\nFatto. Risultati in outputs/benchmark-arc/ (summary.json, summary.md)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
