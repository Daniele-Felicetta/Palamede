// Palamede hub — statici + proxy ai backend + coda mutex sulla GPU.
//
// Regola di prodotto (vedi SPEC.md): mai due generazioni contemporanee.
// Le richieste vengono serialize da questa catena di promise: la coda è
// condivisa fra i due modelli, il che vale sia per richieste concorrenti
// allo stesso modello sia per richieste incrociate bonsai↔z-image.
//
// Avvio: node hub/server.mjs   (porta: env PALAMEDE_PORT, default 4600)

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'frontend', 'dist')
const PORT = Number(process.env.PALAMEDE_PORT || 4600)

const UPSTREAM = {
  bonsai: process.env.PALAMEDE_BONSAI || 'http://127.0.0.1:8000',
  zimage: process.env.PALAMEDE_ZIMAGE || 'http://127.0.0.1:8123',
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

// ── coda mutex ───────────────────────────────────────────────────────────
let chain = Promise.resolve()
function queued(fn) {
  const run = chain.then(fn, fn) // continua la coda anche dopo errori
  chain = run.then(() => {}, () => {})
  return run
}

// ── helper ──────────────────────────────────────────────────────────────
function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = []
  let len = 0
  for await (const c of req) {
    len += c.length
    if (len > limit) throw new Error('body troppo grande')
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function probe(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

// ── route /api ───────────────────────────────────────────────────────────
async function handleApi(req, res, path) {
  if (path === '/api/health' && req.method === 'GET') {
    const [bonsai, zimage] = await Promise.all([
      fetch(UPSTREAM.bonsai + '/backends').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      probe(UPSTREAM.zimage + '/sdapi/v1/options'),
    ])
    return json(res, 200, {
      bonsai: { ok: !!(bonsai && bonsai.healthy), family: bonsai?.default_family ?? null },
      zimage: { ok: zimage },
    })
  }

  if (path === '/api/image' && req.method === 'POST') {
    let p
    try {
      p = JSON.parse(await readBody(req))
    } catch (e) {
      return json(res, 400, { error: { message: 'JSON non valido: ' + e.message } })
    }
    const model = p.model
    if (!['bonsai', 'zimage'].includes(model)) {
      return json(res, 400, { error: { message: "model deve essere 'bonsai' o 'zimage'" } })
    }
    const prompt = String(p.prompt || '').trim()
    if (!prompt) return json(res, 400, { error: { message: 'prompt vuoto' } })

    const count = Math.min(4, Math.max(1, Number(p.count) || 1))
    const width = Number(p.width) || 512
    const height = Number(p.height) || 512
    const steps = Number(p.steps) || (model === 'bonsai' ? 4 : 8)
    const seedIn = Number.isFinite(Number(p.seed)) ? Number(p.seed) : -1

    try {
      const images = await queued(async () => {
        const out = []
        for (let i = 0; i < count; i++) {
          // seed -1 → lo genera il hub, così è riproducibile e mostrabile
          const eff = seedIn === -1
            ? Math.floor(Math.random() * 2 ** 31)
            : seedIn + i
          const t0 = Date.now()
          const gen =
            model === 'bonsai'
              ? generateBonsai({ prompt, width, height, steps, seed: eff })
              : generateZimage({ prompt, width, height, steps, seed: eff })
          const { dataUrl } = await gen
          out.push({
            dataUrl,
            timeMs: Date.now() - t0,
            seed: eff,
            params: { model, prompt, width, height, steps, count },
          })
        }
        return out
      })
      return json(res, 200, { images })
    } catch (e) {
      return json(res, 502, { error: { message: `backend ${model} : ${e.message}` } })
    }
  }

  return json(res, 404, { error: { message: 'endpoint inesistente' } })
}

// ── chiamanti backend ────────────────────────────────────────────────────
async function generateBonsai({ prompt, width, height, steps, seed }) {
  const body = {
    prompt, width, height, steps, seed,
    backend: 'bonsai-ternary-gemlite',
  }
  const r = await fetch(UPSTREAM.bonsai + '/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}` }
}

async function generateZimage({ prompt, width, height, steps, seed }) {
  const body = { prompt, width, height, steps, cfg_scale: 1.0, seed }
  const r = await fetch(UPSTREAM.zimage + '/sdapi/v1/txt2img', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  if (!j.images?.[0]) throw new Error('risposta senza immagini')
  return { dataUrl: `data:image/png;base64,${j.images[0]}` }
}

// ── statici ──────────────────────────────────────────────────────────────
async function serveStatic(res, path) {
  let file = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  if (file === '' ) file = 'index.html'
  const abs = join(DIST, file)
  if (!abs.startsWith(DIST)) return json(res, 403, { error: { message: 'forbidden' } })
  try {
    const s = await stat(abs)
    if (s.isDirectory()) throw new Error('dir')
    const data = await readFile(abs)
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
    })
    res.end(data)
  } catch {
    // SPA fallback hash-routed: tutto il resto è index.html
    try {
      const idx = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': idx.length })
      res.end(idx)
    } catch {
      json(res, 404, { error: { message: 'frontend non costruito: npm run build in frontend/' } })
    }
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  try {
    if (path.startsWith('/api/')) return await handleApi(req, res, path)
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(res, path)
    json(res, 405, { error: { message: 'metodo non ammesso' } })
  } catch (e) {
    json(res, 500, { error: { message: e.message } })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Palamede hub su http://127.0.0.1:${PORT}`)
  console.log(`  bonsai → ${UPSTREAM.bonsai}   z-image → ${UPSTREAM.zimage}`)
})
