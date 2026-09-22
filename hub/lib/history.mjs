// Palamede hub — cronologia immagini (persistente su outputs/history).
// Le immagini generate vengono salvate su disco (niente limiti localStorage)
// con un indice JSON; la lista è limitata alle ultime HIST_MAX.
// La scrittura passa dalla coda mutex condivisa (coerenza indice/file).

import { readFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { json, readBody } from './http.mjs'

const HIST_DIR = join(ROOT, 'outputs', 'history')
const HIST_INDEX = join(HIST_DIR, 'index.json')
const HIST_MAX = 60

function histIndex() {
  try { return JSON.parse(readFileSync(HIST_INDEX, 'utf8')) } catch { return [] }
}

function histSave(list) {
  mkdirSync(HIST_DIR, { recursive: true })
  writeFileSync(HIST_INDEX, JSON.stringify(list))
}

function validPngId(id) {
  return /^[a-zA-Z0-9._-]+$/.test(id) && id.endsWith('.png')
}

export function createHistoryRoutes(queued) {
  return async function handleHistory(req, res, path) {
    // lista metadati (immagini caricate lazy via /api/history/img/<id>)
    if (path === '/api/history' && req.method === 'GET') {
      return json(res, 200, histIndex())
    }

    // svuota tutto (file + indice)
    if (path === '/api/history/clear' && req.method === 'POST') {
      try {
        for (const e of histIndex()) {
          try { unlinkSync(join(HIST_DIR, e.id)) } catch { /* già sparito */ }
        }
        histSave([])
        return json(res, 200, { ok: true })
      } catch (e) {
        return json(res, 500, { error: { message: e.message } })
      }
    }

    // elimina una singola voce (file + indice)
    const dm = path.match(/^\/api\/history\/delete\/([^/]+)$/)
    if (dm && req.method === 'POST') {
      const id = dm[1]
      if (!validPngId(id)) {
        return json(res, 400, { error: { message: 'id non valido' } })
      }
      const list = histIndex()
      const next = list.filter((e) => e.id !== id)
      if (next.length === list.length) {
        return json(res, 404, { error: { message: 'voce non trovata' } })
      }
      try { unlinkSync(join(HIST_DIR, id)) } catch { /* già sparito */ }
      histSave(next)
      return json(res, 200, { ok: true })
    }

    // salva una generazione
    if (path === '/api/history/save' && req.method === 'POST') {
      return queued(async () => {
        try {
          const b = await readBody(req)
          const { model, prompt, size, seed, steps, timeMs, dataUrl } = b
          if (!dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
            return json(res, 400, { error: { message: 'dataUrl png mancante' } })
          }
          mkdirSync(HIST_DIR, { recursive: true })
          const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
          writeFileSync(join(HIST_DIR, id), buf)
          const list = histIndex()
          list.unshift({ id, model, prompt, size, seed, steps, timeMs, ts: Date.now() })
          // cap: cancella i file fuori lista
          const drop = list.splice(HIST_MAX)
          for (const d of drop) {
            try { unlinkSync(join(HIST_DIR, d.id)) } catch { /* già sparito */ }
          }
          histSave(list)
          return json(res, 200, { ok: true, id })
        } catch (e) {
          return json(res, 500, { error: { message: e.message } })
        }
      })
    }

    // serve un'immagine dell'archivio
    const m = path.match(/^\/api\/history\/img\/([^/]+)$/)
    if (m && req.method === 'GET') {
      const id = m[1]
      if (!validPngId(id)) {
        return json(res, 400, { error: { message: 'id non valido' } })
      }
      const abs = join(HIST_DIR, id)
      if (!abs.startsWith(HIST_DIR)) return json(res, 403, { error: { message: 'forbidden' } })
      try {
        const data = await readFile(abs)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
        res.end(data)
        return
      } catch {
        return json(res, 404, { error: { message: 'immagine non trovata' } })
      }
    }

    return json(res, 404, { error: { message: 'endpoint inesistente' } })
  }
}
