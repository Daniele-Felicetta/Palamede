// Palamede — benchmark dei modelli testuali (llama.cpp).
// Velocità: llama-bench (pp512/tg128). Qualità: llama-server + eval set
// automatico a punteggio oggettivo (scripts/bench-text.evalset.json).
// Uso:  node scripts/bench-text.mjs [--only id1,id2] [--skip-bench] [--skip-quality]
// Output: outputs/benchmark/*.json + summary.json + summary.md

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LLAMA_SERVER = join(ROOT, 'tools', 'llama-cpp', 'llama-server.exe')
const LLAMA_BENCH = join(ROOT, 'tools', 'llama-cpp', 'llama-bench.exe')
// porta dedicata (non :8121 della chat, non :8122 del giudice immagini):
// così il banco si può lanciare anche con l'app accesa.
const PORT = Number(process.env.BENCH_PORT || 8127)
const OUT = join(ROOT, 'outputs', 'benchmark')
const LOGS = join(OUT, 'logs')
const EVALSET = JSON.parse(readFileSync(join(ROOT, 'scripts', 'bench-text.evalset.json'), 'utf8'))

const argv = process.argv.slice(2)
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const ONLY = (argVal('--only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const SKIP_BENCH = argv.includes('--skip-bench')
const SKIP_QUALITY = argv.includes('--skip-quality')

// Config per modello. `ncmoe` = primi N layer di esperti MoE in RAM (VRAM<16GB).
// `fallback` = config usata se la primaria non carica (es. OOM).
const MODELS = [
  { id: 'ornith-9b', name: 'Ornith 1.5 9B · Q4_K_M', file: 'models/ornith-1.5-9b/Ornith-1.5-9B-Q4_K_M.gguf', ngl: 99 },
  { id: 'ornith-9b-q5', name: 'Ornith 1.5 9B · Q5_K_M', file: 'models/ornith-1.5-9b/Ornith-1.5-9B-Q5_K_M.gguf', ngl: 99 },
  { id: 'ornith-35b', name: 'Ornith 1.5 35B-A3B · Q4_K_M', file: 'models/ornith-1.5-35b/Ornith-1.5-35B-Q4_K_M.gguf', ngl: 99, ncmoe: 30, moe: true, fallback: { ncmoe: -1 } },
  { id: 'k2-7b', name: 'K2 Horizon 7B · Q4_K_M', file: 'models/k2-7b/K2-Horizon-7B-Q4_K_M.gguf', ngl: 99 },
  { id: 'k2-36b', name: 'K2 Horizon 36B-A4B MoVA · Q4_K_M', file: 'models/k2-36b/K2-Horizon-MoVA-36B-A4B-Q4_K_M.gguf', ngl: 99, ncmoe: 45, moe: true, mova: true, fallback: { ncmoe: -1 } },
  { id: 'bonsai-27b', name: 'Bonsai 27B · Q1_0', file: 'models/bonsai-27b/Bonsai-27B-Q1_0.gguf', ngl: 99 },
  { id: 'lfm-vl-3b', name: 'LFM2.5 VL 3B · Q5_K_XL', file: 'models/lfm-vl-3b/LFM2.5-VL-3B-Q5_K_XL.gguf', ngl: 99 },
  { id: 'gemma-4-26b', name: 'Gemma 4 26B-A3.8B · IQ3_S', file: 'models/gemma-4-26b/gemma-4-26B-A4B-it-UD-IQ3_S.gguf', ngl: 99, moe: true, fallback: { cpuMoe: true } },
  { id: 'minicpm5-2b', name: 'MiniCPM5 2B · Q4_K_M', file: 'models/minicpm5-2b/MiniCPM5-2B-Q4_K_M.gguf', ngl: 99 },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function offloadArgs(cfg) {
  const a = []
  if (cfg.cpuMoe) a.push('--cpu-moe')
  else if (cfg.ncmoe === -1) a.push('--cpu-moe')
  else if (cfg.ncmoe > 0) a.push('--n-cpu-moe', String(cfg.ncmoe))
  if (cfg.mova && cfg.movaCpu) a.push('-ot', 'attn_v_exps=CPU')
  return a
}

function benchArgs(cfg) {
  const a = ['-m', join(ROOT, cfg.file), '-ngl', String(cfg.ngl ?? 99), '-fa', 'on',
    '-ctk', 'q8_0', '-ctv', 'q8_0', '-p', '512', '-n', '128', '-r', '3', '-o', 'json']
  if (cfg.cpuMoe || cfg.ncmoe === -1) a.push('-ncmoe', '999')
  else if (cfg.ncmoe > 0) a.push('-ncmoe', String(cfg.ncmoe))
  if (cfg.mova && cfg.movaCpu) a.push('-ot', 'attn_v_exps=CPU')
  return a
}

function serverArgs(cfg) {
  const a = ['-m', join(ROOT, cfg.file), '--host', '127.0.0.1', '--port', String(PORT),
    '-c', '4096', '-ngl', String(cfg.ngl ?? 99), '--flash-attn', 'on', '--no-warmup',
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--reasoning', 'off',
    ...offloadArgs(cfg)]
  return a
}

function runProc(exe, args, logFile, timeoutMs) {
  return new Promise((resolve) => {
    const out = []
    const err = []
    const proc = spawn(exe, args, { cwd: ROOT, windowsHide: true })
    const t = setTimeout(() => { try { proc.kill() } catch {} }, timeoutMs)
    proc.stdout.on('data', (d) => { out.push(d); if (logFile) appendFileSync(logFile, d) })
    proc.stderr.on('data', (d) => { err.push(d); if (logFile) appendFileSync(logFile, d) })
    proc.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: out.join(''), err: String(e) }) })
    proc.on('exit', (code) => { clearTimeout(t); resolve({ code, out: out.join(''), err: err.join('') }) })
  })
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
  const args = serverArgs(cfg)
  const proc = spawn(LLAMA_SERVER, args, { cwd: ROOT, windowsHide: true })
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

function parseBenchJson(text) {
  const i = text.indexOf('[')
  const j = text.lastIndexOf(']')
  if (i < 0 || j < 0) return null
  try { return JSON.parse(text.slice(i, j + 1)) } catch { return null }
}

async function runBench(cfg) {
  const logFile = join(LOGS, `${cfg.id}.bench.log`)
  writeFileSync(logFile, `--- llama-bench ${JSON.stringify(benchArgs(cfg))} ---\n`)
  const r = await runProc(LLAMA_BENCH, benchArgs(cfg), logFile, 600_000)
  const arr = parseBenchJson(r.out)
  if (!arr) return { ok: false, err: 'parse llama-bench fallito', raw: r.err.slice(-800) }
  const pp = arr.find((x) => x.n_prompt > 0 && (x.n_gen || 0) === 0) || arr.find((x) => x.n_prompt > 0)
  const tg = arr.find((x) => (x.n_prompt || 0) === 0 && x.n_gen > 0) || arr.find((x) => x.n_gen > 0)
  return {
    ok: true,
    pp512: pp ? { ts: pp.avg_ts, sd: pp.stddev_ts } : null,
    tg128: tg ? { ts: tg.avg_ts, sd: tg.stddev_ts } : null,
    raw: arr,
  }
}

function scoreItem(item, text) {
  const t = (text || '').trim()
  const low = t.toLowerCase()
  if (item.type === 'mcq') {
    let letter = null
    const m = t.match(/(?:answer|risposta|opzione|lettera)\s*(?:is|:)?\s*[\(\[]?\s*([ABCD])\b/i)
    if (m) letter = m[1].toUpperCase()
    else {
      const all = t.match(/\b[ABCD]\b/g)
      if (all && all.length) letter = all[all.length - 1].toUpperCase()
    }
    return { ok: letter === item.answer.toUpperCase(), got: letter }
  }
  if (item.type === 'number') {
    const m = t.replace(/\.(?=\d{3}\b)/g, '').match(/(?:answer|risposta|risultato|vale|=|:)\s*(-?\d+(?:[.,]\d+)?)/i)
    let got = m ? m[1].replace(',', '.') : null
    if (got === null) {
      const nums = t.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g)
      got = nums && nums.length ? nums[nums.length - 1] : null
    }
    return { ok: got !== null && Math.abs(Number(got) - Number(item.answer)) < 1e-6, got }
  }
  if (item.type === 'contains') {
    const subs = item.answer.map((s) => s.toLowerCase())
    const hit = subs.map((s) => low.includes(s))
    const ok = item.mode === 'any' ? hit.some(Boolean) : hit.every(Boolean)
    return { ok, got: subs.map((s, i) => `${s}:${hit[i] ? 'Y' : 'N'}`).join(' ') }
  }
  return { ok: false, got: 'tipo sconosciuto' }
}

async function ask(item) {
  const body = {
    messages: [{ role: 'system', content: EVALSET.system }, { role: 'user', content: item.prompt }],
    temperature: 0, top_p: 1, seed: 42, max_tokens: 512, stream: false,
  }
  const t0 = Date.now()
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  })
  const j = await r.json()
  const msg = j.choices?.[0]?.message || {}
  const content = (msg.content || '').trim() || (msg.reasoning_content || '').trim()
  return { content, ms: Date.now() - t0, usage: j.usage || null }
}

async function runQuality(cfg) {
  const items = []
  for (const item of EVALSET.items) {
    let res, sc
    try {
      const a = await ask(item)
      res = a.content
      sc = scoreItem(item, res)
      items.push({ id: item.id, category: item.category, type: item.type, ok: sc.ok, got: sc.got, ms: a.ms, content: res.slice(0, 400) })
    } catch (e) {
      items.push({ id: item.id, category: item.category, type: item.type, ok: false, got: 'ERR ' + String(e).slice(0, 120), ms: 0, content: '' })
    }
    process.stdout.write(sc && sc.ok ? '.' : 'x')
  }
  process.stdout.write('\n')
  const total = items.length
  const correct = items.filter((x) => x.ok).length
  const byCat = {}
  for (const it of items) {
    byCat[it.category] = byCat[it.category] || { correct: 0, total: 0 }
    byCat[it.category].total++
    if (it.ok) byCat[it.category].correct++
  }
  return { score: correct / total, correct, total, byCategory: byCat, items }
}

async function benchModel(cfg) {
  console.log(`\n=== ${cfg.id} — ${cfg.name} ===`)
  const result = { id: cfg.id, name: cfg.name, file: cfg.file, ts: new Date().toISOString() }

  if (!SKIP_BENCH) {
    console.log('  [speed] llama-bench pp512/tg128 ...')
    result.speed = await runBench(cfg)
    if (result.speed.ok) {
      console.log(`  [speed] pp512=${result.speed.pp512?.ts?.toFixed(1)} t/s  tg128=${result.speed.tg128?.ts?.toFixed(1)} t/s`)
    } else {
      console.log(`  [speed] FALLITO: ${result.speed.err}`)
    }
  }

  if (!SKIP_QUALITY) {
    console.log('  [quality] avvio llama-server ...')
    let s = await startServer(cfg, '')
    let usedCfg = { ...cfg }
    if (!s.ok && cfg.fallback) {
      console.log(`  [quality] load fallito (${s.err}), provo fallback ${JSON.stringify(cfg.fallback)}`)
      usedCfg = { ...cfg, ...cfg.fallback }
      s = await startServer(usedCfg, '.fallback')
    }
    if (!s.ok) {
      console.log(`  [quality] FALLITO: ${s.err}`)
      result.quality = { score: null, err: s.err }
    } else {
      result.loadMs = s.loadMs
      result.qualityConfig = { ngl: usedCfg.ngl, ncmoe: usedCfg.ncmoe ?? null, cpuMoe: !!usedCfg.cpuMoe, movaCpu: !!usedCfg.movaCpu }
      console.log(`  [quality] pronto in ${(s.loadMs / 1000).toFixed(1)}s, ${EVALSET.items.length} item ...`)
      result.quality = await runQuality(usedCfg)
      console.log(`  [quality] score ${(result.quality.score * 100).toFixed(1)}% (${result.quality.correct}/${result.quality.total})`)
      await stopServer(s.proc)
    }
  }

  writeFileSync(join(OUT, `${cfg.id}.json`), JSON.stringify(result, null, 2))
  return result
}

function buildSummary(results) {
  const categories = [...new Set(EVALSET.items.map((i) => i.category))]
  const rows = results.map((r) => {
    const pp = r.speed?.ok ? r.speed.pp512?.ts ?? null : null
    const tg = r.speed?.ok ? r.speed.tg128?.ts ?? null : null
    const q = r.quality && r.quality.score != null ? r.quality.score : null
    const byCategory = {}
    if (r.quality?.byCategory) {
      for (const [c, v] of Object.entries(r.quality.byCategory)) byCategory[c] = v.total ? v.correct / v.total : null
    }
    return { id: r.id, name: r.name, pp, tg, q, loadMs: r.loadMs ?? null, byCategory, qualityConfig: r.qualityConfig ?? null }
  })
  const maxTg = Math.max(...rows.map((x) => x.tg || 0), 0.0001)
  for (const r of rows) {
    r.speedNorm = r.tg != null ? (r.tg / maxTg) * 100 : null
    r.combined = r.q != null && r.speedNorm != null ? 0.5 * r.q * 100 + 0.5 * r.speedNorm : null
  }
  const rank = (key, dir = -1) => [...rows].filter((r) => r[key] != null).sort((a, b) => dir * (a[key] - b[key]))
  const byQuality = rank('q').map((r, i) => ({ pos: i + 1, id: r.id, val: r.q }))
  const bySpeed = rank('tg').map((r, i) => ({ pos: i + 1, id: r.id, val: r.tg }))
  const byCombined = rank('combined').map((r, i) => ({ pos: i + 1, id: r.id, val: r.combined }))
  return {
    generatedAt: new Date().toISOString(),
    hardware: 'RTX 5060 Ti 16GB',
    evalCount: EVALSET.items.length,
    categories,
    method: {
      speed: 'llama-bench pp512/tg128 · KV q8_0 · flash-attn · 3 ripetizioni',
      quality: `${EVALSET.items.length} item a punteggio oggettivo (scelta multipla, numero esatto, sottostringhe) · temperatura 0 · reasoning off`,
    },
    rows, byQuality, bySpeed, byCombined,
  }
}

function writeMarkdown(sum) {
  const name = (id) => sum.rows.find((r) => r.id === id)?.name || id
  const f = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d))
  let md = `# Benchmark modelli testuali — Palamede\n\n`
  md += `Generato: ${sum.generatedAt} · GPU: ${sum.hardware}\n\n`
  md += `Velocità = llama-bench (pp512 prompt / tg128 generazione, q8_0 KV, flash-attn, 3 ripetizioni).\n`
  md += `Qualità = ${EVALSET.items.length} item a punteggio oggettivo (scelta multipla, numero esatto, sottostringhe), temperatura 0.\n\n`
  md += `| Modello | Qualità % | pp512 t/s | tg128 t/s | Load s | Combined |\n|---|---|---|---|---|---|\n`
  for (const r of sum.rows) {
    md += `| ${r.name} | ${r.q == null ? '—' : (r.q * 100).toFixed(1)} | ${f(r.pp)} | ${f(r.tg)} | ${r.loadMs ? (r.loadMs / 1000).toFixed(1) : '—'} | ${f(r.combined)} |\n`
  }
  md += `\n## Classifica per QUALITÀ\n\n| # | Modello | Score |\n|---|---|---|\n`
  for (const r of sum.byQuality) md += `| ${r.pos} | ${name(r.id)} | ${(r.val * 100).toFixed(1)}% |\n`
  md += `\n## Classifica per VELOCITÀ (tg128)\n\n| # | Modello | t/s |\n|---|---|---|\n`
  for (const r of sum.bySpeed) md += `| ${r.pos} | ${name(r.id)} | ${f(r.val)} |\n`
  md += `\n## Classifica COMBINATA (50% qualità + 50% velocità normalizzata)\n\n| # | Modello | Combined |\n|---|---|---|\n`
  for (const r of sum.byCombined) md += `| ${r.pos} | ${name(r.id)} | ${f(r.val)} |\n`
  writeFileSync(join(OUT, 'summary.md'), md)
}

async function main() {
  if (!existsSync(LLAMA_SERVER)) throw new Error(`manca ${LLAMA_SERVER}`)
  mkdirSync(LOGS, { recursive: true })
  const list = MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))
  console.log(`Benchmark ${list.length} modelli (${SKIP_BENCH ? 'no speed' : 'speed'}${SKIP_QUALITY ? '' : ' + quality'})`)
  const results = []
  for (const cfg of list) {
    if (!existsSync(join(ROOT, cfg.file))) { console.log(`SKIP ${cfg.id}: manca ${cfg.file}`); continue }
    results.push(await benchModel(cfg))
  }
  const map = new Map()
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith('.json') || f === 'summary.json') continue
    try { const r = JSON.parse(readFileSync(join(OUT, f), 'utf8')); if (r.id) map.set(r.id, r) } catch {}
  }
  for (const r of results) map.set(r.id, r)
  const merged = [...map.values()]
  const summary = buildSummary(merged)
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  writeMarkdown(summary)
  console.log(`\nFatto. Risultati in outputs/benchmark/ (summary.json, summary.md)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
