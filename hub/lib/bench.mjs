// Palamede hub — benchmark (sezione Banco nella UI).
// Serve outputs/benchmark/summary.json (modelli testuali) e
// outputs/benchmark-images/summary.json + le immagini generate (modelli
// immagine). Prodotti da scripts/bench-text.mjs e scripts/bench-images.mjs.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { json } from './http.mjs'

export async function handleBench(req, res) {
  try {
    const text = await readFile(join(ROOT, 'outputs', 'benchmark', 'summary.json'), 'utf8')
    return json(res, 200, JSON.parse(text))
  } catch {
    return json(res, 404, { error: { message: 'nessun benchmark registrato: esegui node scripts/bench-text.mjs' } })
  }
}

export async function handleBenchImages(req, res) {
  try {
    const text = await readFile(join(ROOT, 'outputs', 'benchmark-images', 'summary.json'), 'utf8')
    return json(res, 200, JSON.parse(text))
  } catch {
    return json(res, 404, { error: { message: 'nessun benchmark immagini: esegui node scripts/bench-images.mjs' } })
  }
}

const IMG_MODELS = new Set(['bonsai', 'zimage', 'klein', 'qwenimage'])

export async function handleBenchImageFile(req, res, path) {
  const m = path.match(/^\/api\/bench-images\/file\/([^/]+)\/([^/]+)$/)
  if (!m) return json(res, 400, { error: { message: 'id non valido' } })
  const [, model, name] = m
  if (!IMG_MODELS.has(model) || !/^[a-z0-9_-]+\.png$/i.test(name)) {
    return json(res, 403, { error: { message: 'forbidden' } })
  }
  const dir = join(ROOT, 'outputs', 'benchmark-images', model)
  const abs = join(dir, name)
  if (!abs.startsWith(dir)) return json(res, 403, { error: { message: 'forbidden' } })
  try {
    const data = await readFile(abs)
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
    res.end(data)
  } catch {
    return json(res, 404, { error: { message: 'immagine non trovata' } })
  }
}
