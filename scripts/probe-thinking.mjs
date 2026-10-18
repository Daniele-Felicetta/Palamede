// Palamede — sonda "il modello ragiona davvero?".
// Lancia ogni modello con --reasoning on e guarda se la risposta porta
// reasoning_content non vuoto. Serve a distinguere i modelli che hanno il
// supporto nel template (ce l'hanno quasi tutti i Qwen-family) da quelli che
// emettono davvero ragionamento.
// Uso: node scripts/probe-thinking.mjs [--only id1,id2]

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LLAMA_BUILD = ['llama-cpp-b11707', 'llama-cpp-b11457', 'llama-cpp'].map((d) => join(ROOT, 'tools', d))
  .find((d) => existsSync(join(d, 'llama-server.exe')))
const SERVER = join(LLAMA_BUILD, 'llama-server.exe')
const PORT = 8131
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MODELS = [
  { id: 'ornith-9b', file: 'models/ornith-1.5-9b/Ornith-1.5-9B-Q4_K_M.gguf' },
  { id: 'ornith-9b-q5', file: 'models/ornith-1.5-9b/Ornith-1.5-9B-Q5_K_M.gguf' },
  { id: 'ornith-35b', file: 'models/ornith-1.5-35b/Ornith-1.5-35B-Q4_K_M.gguf', ncmoe: 30 },
  { id: 'k2-7b', file: 'models/k2-7b/K2-Horizon-7B-Q4_K_M.gguf' },
  { id: 'k2-36b', file: 'models/k2-36b/K2-Horizon-MoVA-36B-A4B-Q4_K_M.gguf', ncmoe: 45 },
  { id: 'bonsai-27b', file: 'models/bonsai-27b/Bonsai-27B-Q1_0.gguf' },
  { id: 'lfm-vl-3b', file: 'models/lfm/lfm-vl-3b/LFM2.5-VL-3B-Q5_K_XL.gguf' },
  { id: 'lfm-24a2b', file: 'models/lfm/lfm-24a2b/LFM2.5-24B-A2B-UD-Q5_K_XL.gguf', ncmoe: 30 },
  { id: 'gemma-4-26b', file: 'models/gemma-4-26b/gemma-4-26B-A4B-it-UD-IQ3_S.gguf', cpuMoe: true },
  { id: 'gemma-4-12b', file: 'models/Jarvis/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf' },
  { id: 'minicpm5-2b', file: 'models/minicpm5-2b/MiniCPM5-2B-Q4_K_M.gguf' },
  { id: 'qwen38-27b', file: 'models/qwen38-27b/Qwen3.8-27B-GSQ-RCO-IQ3_XXS.gguf' },
  { id: 'minicpm-v47-35b', file: 'models/minicpm-v47-35b/MiniCPM-V-4_7-35B-A3B-Q4_K_M.gguf', ncmoe: 30 },
  // Nemotron 3.5 Bolt: MoE con esperti diversi per layer (240..496) -> serve
  // llama.cpp >= b11707. `ot`: solo i tensori per-esperto in CPU (con
  // --n-cpu-moe il decode scende a 3,6 t/s invece di ~17).
  { id: 'nemotron-bolt-74b', file: 'models/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-UD-Q3_K_XL.gguf', ncmoe: 40, ot: 'blk\\.[0-9]+\\.ffn_(up_exps|down_exps|gate_inp|exp_probs_b)=CPU' },
  { id: 'nemotron-bolt-74b-q2', file: 'models/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-UD-Q2_K_XL.gguf', ncmoe: 40, ot: 'blk\\.[0-9]+\\.ffn_(up_exps|down_exps|gate_inp|exp_probs_b)=CPU' },
]

const argv = process.argv.slice(2)
const ONLY = (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '').split(',').map((s) => s.trim()).filter(Boolean)

async function health() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) })
    return r.ok && (await r.json()).status === 'ok'
  } catch { return false }
}

async function probe(cfg) {
  const args = ['-m', join(ROOT, cfg.file), '--host', '127.0.0.1', '--port', String(PORT),
    '-c', '2048', '-ngl', '99', '--flash-attn', 'on', '--no-warmup',
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--reasoning', 'on']
  if (cfg.ot) args.push('-ot', cfg.ot)
  else if (cfg.cpuMoe) args.push('--cpu-moe')
  else if (cfg.ncmoe > 0) args.push('--n-cpu-moe', String(cfg.ncmoe))
  const proc = spawn(SERVER, args, { cwd: ROOT, windowsHide: true })
  let dead = false
  proc.on('exit', () => { dead = true })
  const deadline = Date.now() + 240_000
  let ready = false
  while (Date.now() < deadline && !dead) {
    if (await health()) { ready = true; break }
    await sleep(700)
  }
  if (!ready) { try { proc.kill() } catch {} ; return { id: cfg.id, error: 'load fallito' } }
  let out = { id: cfg.id, thinks: false, reasonChars: 0, contentChars: 0 }
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Un treno percorre 60 km in 45 minuti. Qual è la velocità media in km/h?' }],
        temperature: 0, max_tokens: 512, stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    })
    const j = await r.json()
    const m = j.choices?.[0]?.message || {}
    out.reasonChars = (m.reasoning_content || '').trim().length
    out.contentChars = (m.content || '').trim().length
    out.thinks = out.reasonChars > 40
    out.sample = (m.reasoning_content || '').trim().slice(0, 90)
  } catch (e) {
    out.error = String(e).slice(0, 90)
  }
  try { proc.kill() } catch {}
  await sleep(2500)
  return out
}

const list = MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))
const results = []
for (const cfg of list) {
  if (!existsSync(join(ROOT, cfg.file))) { console.log(`SKIP ${cfg.id}: manca il file`); continue }
  process.stdout.write(`  ${cfg.id} ... `)
  const r = await probe(cfg)
  results.push(r)
  console.log(r.error ? `ERR ${r.error}` : `thinking=${r.thinks ? 'SI' : 'no'} (reason ${r.reasonChars} char, risposta ${r.contentChars})`)
}
console.log('\n--- riepilogo ---')
for (const r of results) console.log(`${r.id.padEnd(18)} ${r.thinks ? 'RAGIONA' : 'no'}`)
console.log(`\nmodelli che ragionano: ${results.filter((r) => r.thinks).map((r) => r.id).join(', ') || 'nessuno'}`)