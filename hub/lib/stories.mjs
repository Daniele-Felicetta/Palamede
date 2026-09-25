// Palamede hub — archivio partite di Bandersketch (outputs/stories).
// Ogni partita salva snapshot completo: testi dei capitoli, etichette e scene
// dei bivi, scelta fatta, prompt-scena e seed di ogni tavola (PNG su disco).
// Serve a consultare le storie prodotte e a diagnosticare problemi
// (testo↔immagine: ogni PNG è risalibile a scena+seed).
// Pattern uguale a history.mjs: indice JSON + file, scritture in coda mutex.

import { readFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { json, errorJson, readBody } from './http.mjs'

const STORIES_DIR = join(ROOT, 'outputs', 'stories')
const STORIES_INDEX = join(STORIES_DIR, 'index.json')
const STORIES_MAX = 30

function storiesIndex() {
  try {
    const v = JSON.parse(readFileSync(STORIES_INDEX, 'utf8'))
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function storiesSave(list) {
  mkdirSync(STORIES_DIR, { recursive: true })
  writeFileSync(STORIES_INDEX, JSON.stringify(list))
}

function validSid(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

function validPng(f) {
  return typeof f === 'string' && /^[a-z0-9_-]+\.png$/.test(f)
}

function storyPath(sid) {
  const abs = join(STORIES_DIR, sid)
  if (!abs.startsWith(STORIES_DIR)) return null
  return abs
}

export function createStoriesRoutes(queued) {
  return async function handleStories(req, res, path) {
    // lista riassunti (niente testi: leggera)
    if (path === '/api/stories' && req.method === 'GET') {
      return json(res, 200, storiesIndex())
    }

    // upsert snapshot completo di una partita
    if (path === '/api/stories/save' && req.method === 'POST') {
      return queued(async () => {
        try {
          const b = await readBody(req)
          const { id, meta, chapters, forks, images } = b || {}
          if (!validSid(id)) return json(res, 400, { error: { message: 'id sessione non valido' } })
          const dir = storyPath(id)
          if (!dir) return json(res, 403, { error: { message: 'forbidden' } })
          mkdirSync(dir, { recursive: true })
          // PNG: nomi deterministici dal client (ch1.png, ch2a.png…).
          // L'ultima scrittura vince: se il capitolo è stato rigenerato, la
          // tavola nuova sostituisce quella vecchia (niente immagini stale).
          if (images && typeof images === 'object') {
            for (const [file, dataUrl] of Object.entries(images)) {
              if (!validPng(file)) continue
              const abs = join(dir, file)
              if (!abs.startsWith(dir)) continue
              if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) continue
              try { writeFileSync(abs, Buffer.from(dataUrl.split(',')[1], 'base64')) } catch { /* corrotta: ignora */ }
            }
          }
          const doc = {
            id,
            meta: meta && typeof meta === 'object' ? meta : {},
            chapters: Array.isArray(chapters) ? chapters : [],
            forks: Array.isArray(forks) ? forks : [],
            updated: Date.now(),
          }
          const prev = join(dir, 'story.json')
          let created = Date.now()
          try {
            const old = JSON.parse(readFileSync(prev, 'utf8'))
            if (old && typeof old.created === 'number') created = old.created
          } catch { /* prima scrittura */ }
          doc.created = created
          writeFileSync(prev, JSON.stringify(doc))
          // indice: un riassunto per partita (testi esclusi)
          const list = storiesIndex().filter((e) => e.id !== id)
          list.unshift({
            id,
            genre: doc.meta.genre || '',
            name: doc.meta.name || '',
            narrator: doc.meta.narrator || '',
            painter: doc.meta.painter || '',
            chapters: doc.chapters.length,
            choices: doc.forks.filter((f) => f.picked !== null && f.picked !== undefined).length,
            created,
            updated: doc.updated,
          })
          const drop = list.splice(STORIES_MAX)
          for (const d of drop) {
            try { rmSync(storyPath(d.id), { recursive: true, force: true }) } catch { /* già sparita */ }
          }
          storiesSave(list)
          return json(res, 200, { ok: true, id })
        } catch (e) {
          return errorJson(res, e)
        }
      })
    }

    // elimina una partita
    const dm = path.match(/^\/api\/stories\/delete\/([^/]+)$/)
    if (dm && req.method === 'POST') {
      const sid = dm[1]
      if (!validSid(sid) || !storyPath(sid)) return json(res, 400, { error: { message: 'id non valido' } })
      try { rmSync(storyPath(sid), { recursive: true, force: true }) } catch { /* già sparita */ }
      storiesSave(storiesIndex().filter((e) => e.id !== sid))
      return json(res, 200, { ok: true })
    }

    // svuota l'archivio
    if (path === '/api/stories/clear' && req.method === 'POST') {
      for (const e of storiesIndex()) {
        try { if (validSid(e.id)) rmSync(storyPath(e.id), { recursive: true, force: true }) } catch { /* già sparita */ }
      }
      storiesSave([])
      return json(res, 200, { ok: true })
    }

    // dettaglio partita (testi + nomi file, niente dataUrl)
    const gm = path.match(/^\/api\/stories\/([^/]+)$/)
    if (gm && req.method === 'GET') {
      const sid = gm[1]
      if (!validSid(sid) || !storyPath(sid)) return json(res, 400, { error: { message: 'id non valido' } })
      try {
        const doc = JSON.parse(await readFile(join(storyPath(sid), 'story.json'), 'utf8'))
        return json(res, 200, doc)
      } catch {
        return json(res, 404, { error: { message: 'storia non trovata' } })
      }
    }

    // singola tavola dell'archivio
    const im = path.match(/^\/api\/stories\/([^/]+)\/img\/([^/]+)$/)
    if (im && req.method === 'GET') {
      const sid = im[1]
      const file = im[2]
      if (!validSid(sid)) return json(res, 400, { error: { message: 'id non valido' } })
      if (!validPng(file)) return json(res, 400, { error: { message: 'nome file non valido' } })
      const dir = storyPath(sid)
      if (!dir) return json(res, 403, { error: { message: 'forbidden' } })
      const abs = join(dir, file)
      if (!abs.startsWith(dir)) return json(res, 403, { error: { message: 'forbidden' } })
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
