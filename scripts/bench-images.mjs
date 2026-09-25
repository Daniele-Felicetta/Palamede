// Palamede — benchmark dei modelli immagine.
// Velocità: generazione reale (cold + warm) a 512² e 1024² ai default di
// ciascun modello. Qualità: set fisso di prompt a 512², giudicato da un VLM
// locale (Gemma 4 26B) con rubrica → 0-10.
// Uso: node scripts/bench-images.mjs [--only id1,id2] [--skip-speed] [--skip-quality] [--no-backend]
// Output: outputs/benchmark-images/{summary.json,summary.md,<id>.json,<id>/*.png,logs/}

import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BACKEND = 'http://127.0.0.1:8000'
const JUDGE_PORT = Number(process.env.BENCH_JUDGE_PORT || 8122)
const LLAMA_SERVER = join(ROOT, 'tools', 'llama-cpp', 'llama-server.exe')
const JUDGE_MODEL = join(ROOT, 'models', 'gemma-4-26b', 'gemma-4-26B-A4B-it-UD-IQ3_S.gguf')
const JUDGE_MMPROJ = join(ROOT, 'models', 'gemma-4-26b', 'mmproj-Q8_0.gguf')
const OUT = join(ROOT, 'outputs', 'benchmark-images')
const LOGS = join(OUT, 'logs')

const argv = process.argv.slice(2)
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const ONLY = (argVal('--only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const SKIP_SPEED = argv.includes('--skip-speed')
const SKIP_QUALITY = argv.includes('--skip-quality')
const NO_BACKEND = argv.includes('--no-backend')

const MODELS = [
  { id: 'bonsai', name: 'Bonsai 4B ternary', steps: 4, note: 'gemlite int2' },
  { id: 'zimage', name: 'Z-Image Turbo Q4_K_M', steps: 8, note: 'sd.cpp' },
  { id: 'klein', name: 'Klein 4B Q4 (FLUX.2)', steps: 4, note: 'sd.cpp' },
  { id: 'qwenimage', name: 'Qwen-Image 2.1 Q4_K_M', steps: 40, note: 'sd.cpp + cache-dit' },
]

const RES = [
  { w: 512, h: 512, label: '512²' },
  { w: 1024, h: 1024, label: '1024²' },
]

const SPEED_PROMPT = 'A red fox sitting on a mossy rock in a misty forest, photorealistic, soft morning light'

const PROMPTS = [
  { id: 'fox', text: 'A red fox sitting on a mossy rock in a misty forest, photorealistic, soft morning light' },
  { id: 'coffee', text: 'A cozy coffee shop storefront at dusk with a wooden sign that reads FRESH COFFEE, warm interior glow, wet pavement reflections' },
  { id: 'portrait', text: 'Portrait of an elderly fisherman, weathered face, dramatic side lighting, 85mm photo' },
  { id: 'city', text: 'A futuristic city skyline at night with neon signs and rain reflections, cinematic, ultra detailed' },
  { id: 'strawberries', text: 'A bowl of fresh strawberries on a rustic wooden table, soft daylight, macro photography' },
  { id: 'astronaut', text: 'An astronaut riding a horse on the moon, detailed, cinematic lighting' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rel = (p) => p.slice(ROOT.length + 1).replace(/\\/g, '/')

async function backendUp() {
  try { const r = await fetch(BACKEND + '/healthz', { signal: AbortSignal.timeout(2000) }); return r.ok } catch { return false }
}

function killTree(pid) {
  return new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()))
}

async function startBackend() {
  if (await backendUp()) { console.log('  backend già attivo, lo riuso'); return null }
  const logFile = join(LOGS, 'backend.log')
  writeFileSync(logFile, '--- backend ---\n')
  const ps = join(ROOT, 'scripts', 'start-backend.ps1')
  const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Hidden'],
    { cwd: ROOT, windowsHide: true })
  proc.stdout.on('data', (d) => appendFileSync(logFile, d))
  proc.stderr.on('data', (d) => appendFileSync(logFile, d))
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (await backendUp()) { console.log('  backend pronto'); return proc }
    await sleep(1500)
  }
  throw new Error('backend non pronto entro 240s (vedi outputs/benchmark-images/logs/backend.log)')
}

async function stopBackend(proc) {
  if (!proc) return
  await killTree(proc.pid)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) { if (!(await backendUp())) break; await sleep(1000) }
  await sleep(3000)
}

async function selectModel(id) {
  const t0 = Date.now()
  const r = await fetch(BACKEND + '/select', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: id }), signal: AbortSignal.timeout(300_000),
  })
  if (!r.ok) throw new Error(`select ${id}: HTTP ${r.status} ${await r.text().catch(() => '')}`)
  return Date.now() - t0
}

async function generate(id, prompt, steps, seed, w, h) {
  const r = await fetch(BACKEND + '/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: id, prompt, steps, seed, width: w, height: h, count: 1 }),
    signal: AbortSignal.timeout(900_000),
  })
  if (!r.ok) throw new Error(`generate ${id}: HTTP ${r.status} ${await r.text().catch(() => '')}`)
  const j = await r.json()
  if (!j.images?.[0]?.dataUrl) throw new Error(`generate ${id}: risposta senza immagini`)
  return j.images[0]
}

function savePng(dataUrl, dest) {
  const b64 = dataUrl.split(',', 2)[1]
  writeFileSync(dest, Buffer.from(b64, 'base64'))
}

function dataUrlFromFile(file) {
  return 'data:image/png;base64,' + readFileSync(file).toString('base64')
}

async function measureSpeed(cfg) {
  const speed = {}
  for (const r of RES) {
    console.log(`    speed ${r.label} (cold + 2 warm)…`)
    const cold = await generate(cfg.id, SPEED_PROMPT, cfg.steps, 1000, r.w, r.h)
    const w1 = await generate(cfg.id, SPEED_PROMPT, cfg.steps, 1001, r.w, r.h)
    const w2 = await generate(cfg.id, SPEED_PROMPT, cfg.steps, 1002, r.w, r.h)
    const warm = Math.min(w1.timeMs, w2.timeMs)
    speed[r.label] = { coldMs: cold.timeMs, warmMs: warm, samples: [cold.timeMs, w1.timeMs, w2.timeMs] }
    console.log(`      cold ${(cold.timeMs / 1000).toFixed(1)}s · warm ${(warm / 1000).toFixed(1)}s`)
  }
  return speed
}

async function generateQuality(cfg) {
  const dir = join(OUT, cfg.id)
  mkdirSync(dir, { recursive: true })
  const images = []
  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i]
    const file = join(dir, `${String(i).padStart(2, '0')}.png`)
    const img = await generate(cfg.id, p.text, cfg.steps, 4242 + i, 512, 512)
    savePng(img.dataUrl, file)
    images.push({ promptId: p.id, prompt: p.text, file: rel(file), timeMs: img.timeMs, seed: 4242 + i })
    console.log(`      img ${p.id} ${(img.timeMs / 1000).toFixed(1)}s`)
  }
  return images
}

async function benchModel(cfg, manageBackend) {
  console.log(`\n=== ${cfg.id} — ${cfg.name} ===`)
  const result = { id: cfg.id, name: cfg.name, steps: cfg.steps, note: cfg.note, ts: new Date().toISOString() }
  result.loadMs = await selectModel(cfg.id)
  console.log(`  caricato in ${(result.loadMs / 1000).toFixed(1)}s`)
  if (!SKIP_SPEED) result.speed = await measureSpeed(cfg)
  if (!SKIP_QUALITY) result.images = await generateQuality(cfg)
  writeFileSync(join(OUT, `${cfg.id}.json`), JSON.stringify(result, null, 2))
  return result
}

// ── VLM judge ────────────────────────────────────────────────────────────
async function judgeHealth(timeoutMs = 2500) {
  try {
    const r = await fetch(`http://127.0.0.1:${JUDGE_PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (r.ok) return (await r.json()).status === 'ok'
  } catch {}
  return false
}

async function startJudge() {
  if (!existsSync(JUDGE_MODEL) || !existsSync(JUDGE_MMPROJ)) throw new Error('manca il VLM judge (gemma-4-26b + mmproj)')
  const logFile = join(LOGS, 'judge.log')
  const args = ['-m', JUDGE_MODEL, '--mmproj', JUDGE_MMPROJ, '--host', '127.0.0.1', '--port', String(JUDGE_PORT),
    '-c', '8192', '-ngl', '99', '--flash-attn', 'on', '--no-warmup',
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--reasoning', 'off']
  writeFileSync(logFile, `--- judge ${JSON.stringify(args)} ---\n`)
  const proc = spawn(LLAMA_SERVER, args, { cwd: ROOT, windowsHide: true })
  proc.stdout.on('data', (d) => appendFileSync(logFile, d))
  proc.stderr.on('data', (d) => appendFileSync(logFile, d))
  let dead = false
  proc.on('exit', () => { dead = true })
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (dead) throw new Error('judge uscito durante il load (vedi logs/judge.log)')
    if (await judgeHealth(2000)) return proc
    await sleep(1000)
  }
  try { proc.kill() } catch {}
  throw new Error('judge non pronto entro 240s')
}

async function stopJudge(proc) {
  if (!proc) return
  try { proc.kill() } catch {}
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) { if (!(await judgeHealth(1000))) break; await sleep(500) }
  await sleep(3000)
}

const RUBRIC = (prompt) =>
  `You are a strict image-quality judge. The user prompt was:\n"${prompt}"\n\n` +
  `Rate the generated image on three axes, each an INTEGER from 0 to 10:\n` +
  `- prompt_adherence: how faithfully the image matches the prompt (subjects, setting, style)\n` +
  `- realism_quality: photographic/rendering quality, lighting, coherence\n` +
  `- artifacts: absence of defects, distortions, broken anatomy or garbled text (10 = flawless)\n` +
  `Reply with ONLY compact JSON, no prose: {"prompt_adherence": n, "realism_quality": n, "artifacts": n}`

function clamp10(n) { return Math.max(0, Math.min(10, Number(n) || 0)) }

async function judgeImage(file, prompt) {
  const body = {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: RUBRIC(prompt) },
        { type: 'image_url', image_url: { url: dataUrlFromFile(file) } },
      ],
    }],
    temperature: 0, top_p: 1, seed: 42, max_tokens: 200, stream: false,
  }
  const r = await fetch(`http://127.0.0.1:${JUDGE_PORT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  })
  const j = await r.json()
  const msg = j.choices?.[0]?.message || {}
  const text = (msg.content || '').trim() || (msg.reasoning_content || '').trim()
  const m = text.match(/\{[\s\S]*\}/)
  let axes = { prompt_adherence: 0, realism_quality: 0, artifacts: 0 }
  if (m) {
    try {
      const p = JSON.parse(m[0])
      axes = {
        prompt_adherence: clamp10(p.prompt_adherence),
        realism_quality: clamp10(p.realism_quality),
        artifacts: clamp10(p.artifacts),
      }
    } catch { /* parse fallito: resta 0 */ }
  }
  axes.composite = (axes.prompt_adherence + axes.realism_quality + axes.artifacts) / 3
  return { text: text.slice(0, 300), axes }
}

async function judgeAll(results) {
  console.log('\n=== VLM judge (Gemma 4 26B) ===')
  const proc = await startJudge()
  console.log('  judge pronto')
  try {
    for (const r of results) {
      if (!r.images) continue
      const per = []
      for (const img of r.images) {
        try {
          const { axes } = await judgeImage(join(ROOT, img.file), img.prompt)
          per.push({ promptId: img.promptId, ...axes })
          process.stdout.write('.')
        } catch (e) {
          per.push({ promptId: img.promptId, prompt_adherence: 0, realism_quality: 0, artifacts: 0, composite: 0, err: String(e).slice(0, 120) })
          process.stdout.write('x')
        }
      }
      process.stdout.write('\n')
      const n = per.length || 1
      r.quality = {
        score: per.reduce((s, x) => s + (x.composite || 0), 0) / n,
        axes: {
          prompt_adherence: per.reduce((s, x) => s + x.prompt_adherence, 0) / n,
          realism_quality: per.reduce((s, x) => s + x.realism_quality, 0) / n,
          artifacts: per.reduce((s, x) => s + x.artifacts, 0) / n,
        },
        byPrompt: per,
      }
      console.log(`  ${r.id}: qualità ${r.quality.score.toFixed(2)}/10`)
      writeFileSync(join(OUT, `${r.id}.json`), JSON.stringify(r, null, 2))
    }
  } finally {
    await stopJudge(proc)
  }
}

function buildSummary(results) {
  const rows = results.map((r) => {
    const s512 = r.speed?.['512²'] ?? null
    const s1024 = r.speed?.['1024²'] ?? null
    const sps = s512 ? 1000 / s512.warmMs : null
    return {
      id: r.id, name: r.name, steps: r.steps, note: r.note, loadMs: r.loadMs ?? null,
      s512: s512 ? { coldMs: s512.coldMs, warmMs: s512.warmMs } : null,
      s1024: s1024 ? { coldMs: s1024.coldMs, warmMs: s1024.warmMs } : null,
      sps512: sps,
      q: r.quality?.score ?? null,
      axes: r.quality?.axes ?? null,
      images: r.images ?? [],
    }
  })
  const maxSps = Math.max(...rows.map((x) => x.sps512 || 0), 0.0001)
  for (const r of rows) {
    r.speedNorm = r.sps512 != null ? (r.sps512 / maxSps) * 100 : null
    r.combined = r.q != null && r.speedNorm != null ? 0.5 * (r.q / 10) * 100 + 0.5 * r.speedNorm : null
  }
  const rank = (key, dir = -1) => [...rows].filter((r) => r[key] != null).sort((a, b) => dir * (a[key] - b[key]))
  return {
    generatedAt: new Date().toISOString(),
    hardware: 'RTX 5060 Ti 16GB',
    evalCount: PROMPTS.length,
    method: {
      speed: 'generazione reale ai default del modello · 512² e 1024² · cold (primo colpo) + warm (min di 2)',
      quality: `${PROMPTS.length} prompt fissi a 512² (seed 4242+i) · giudice VLM locale Gemma 4 26B · media di aderenza/realismo/artefatti (0-10)`,
    },
    rows,
    byQuality: rank('q').map((r, i) => ({ pos: i + 1, id: r.id, val: r.q })),
    bySpeed: rank('sps512').map((r, i) => ({ pos: i + 1, id: r.id, val: r.sps512 })),
    byCombined: rank('combined').map((r, i) => ({ pos: i + 1, id: r.id, val: r.combined })),
  }
}

function writeMarkdown(sum) {
  const f = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d))
  let md = `# Benchmark modelli immagine — Palamede\n\n`
  md += `Generato: ${sum.generatedAt} · GPU: ${sum.hardware}\n\n`
  md += `Velocità = ${sum.method.speed}.\nQualità = ${sum.method.quality}.\n\n`
  md += `| Modello | Qualità /10 | 512² cold s | 512² warm s | 1024² warm s | img/s 512 | Combined |\n|---|---|---|---|---|---|---|\n`
  for (const r of sum.rows) {
    md += `| ${r.name} | ${f(r.q, 2)} | ${r.s512 ? f(r.s512.coldMs / 1000) : '—'} | ${r.s512 ? f(r.s512.warmMs / 1000) : '—'} | ${r.s1024 ? f(r.s1024.warmMs / 1000) : '—'} | ${f(r.sps512, 3)} | ${f(r.combined, 0)} |\n`
  }
  const name = (id) => sum.rows.find((r) => r.id === id)?.name || id
  md += `\n## Qualità\n\n| # | Modello | /10 |\n|---|---|---|\n`
  for (const r of sum.byQuality) md += `| ${r.pos} | ${name(r.id)} | ${f(r.val, 2)} |\n`
  md += `\n## Velocità (img/s a 512²)\n\n| # | Modello | img/s |\n|---|---|---|\n`
  for (const r of sum.bySpeed) md += `| ${r.pos} | ${name(r.id)} | ${f(r.val, 3)} |\n`
  md += `\n## Combinata\n\n| # | Modello | Combined |\n|---|---|---|\n`
  for (const r of sum.byCombined) md += `| ${r.pos} | ${name(r.id)} | ${f(r.val, 0)} |\n`
  writeFileSync(join(OUT, 'summary.md'), md)
}

async function main() {
  mkdirSync(LOGS, { recursive: true })
  const list = MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))
  console.log(`Benchmark immagini: ${list.length} modelli (${SKIP_SPEED ? 'no speed' : 'speed'}${SKIP_QUALITY ? '' : ' + quality'})`)
  let backend = null
  if (!NO_BACKEND) backend = await startBackend()
  const results = []
  try {
    for (const cfg of list) results.push(await benchModel(cfg))
  } finally {
    await stopBackend(backend)
  }
  if (!SKIP_QUALITY) await judgeAll(results)

  // merge con risultati precedenti (per run parziali)
  const map = new Map()
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith('.json') || f === 'summary.json') continue
    try { const r = JSON.parse(readFileSync(join(OUT, f), 'utf8')); if (r.id) map.set(r.id, r) } catch {}
  }
  for (const r of results) map.set(r.id, r)
  const summary = buildSummary([...map.values()])
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  writeMarkdown(summary)
  console.log('\nFatto. Risultati in outputs/benchmark-images/ (summary.json, summary.md)')
}

main().catch((e) => { console.error(e); process.exit(1) })
