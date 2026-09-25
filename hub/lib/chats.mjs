// Palamede hub — conversazioni chat (persistenti su outputs/chats).
// Ogni chat è un file <id>.json con i messaggi; index.json tiene i metadati
// (id, titolo, modello, ts, n. messaggi). Stesse regole della cronologia
// immagini: id validati, scrittura sotto la coda mutex (coerenza indice/file).

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { json, errorJson, readBody } from './http.mjs'

const CHATS_DIR = join(ROOT, 'outputs', 'chats')
const CHATS_INDEX = join(CHATS_DIR, 'index.json')
const CHATS_MAX = 200

function index() {
  try { return JSON.parse(readFileSync(CHATS_INDEX, 'utf8')) } catch { return [] }
}

function saveIndex(list) {
  mkdirSync(CHATS_DIR, { recursive: true })
  writeFileSync(CHATS_INDEX, JSON.stringify(list))
}

function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9._-]+$/.test(id)
}

function chatPath(id) {
  return join(CHATS_DIR, `${id}.json`)
}

// Titolo di default dal primo messaggio utente (prime ~7 parole).
function titleFrom(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return 'Nuova conversazione'
  const words = t.split(' ').slice(0, 7).join(' ')
  return words.length < t.length ? words + '…' : words
}

export function createChatsRoutes(queued) {
  return async function handleChats(req, res, path) {
    // lista metadati (più recenti prima)
    if (path === '/api/chats' && req.method === 'GET') {
      return json(res, 200, index())
    }

    // una conversazione completa
    const gm = path.match(/^\/api\/chats\/([^/]+)$/)
    if (gm && req.method === 'GET') {
      const id = gm[1]
      if (!validId(id)) return json(res, 400, { error: { message: 'id non valido' } })
      const abs = chatPath(id)
      if (!abs.startsWith(CHATS_DIR)) return json(res, 403, { error: { message: 'forbidden' } })
      try {
        const text = await readFile(abs, 'utf8')
        return json(res, 200, JSON.parse(text))
      } catch {
        return json(res, 404, { error: { message: 'conversazione non trovata' } })
      }
    }

    // crea/salva una conversazione (upsert). Body: { id?, title?, model?, messages }
    if (path === '/api/chats' && req.method === 'POST') {
      return queued(async () => {
        try {
          const b = await readBody(req)
          const messages = Array.isArray(b.messages) ? b.messages : null
          if (!messages) return json(res, 400, { error: { message: 'messages mancanti' } })
          const id = validId(b.id) ? b.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const firstUser = messages.find((m) => m.role === 'user')
          const title = (typeof b.title === 'string' && b.title.trim())
            || titleFrom(typeof firstUser?.content === 'string' ? firstUser.content : '')
          const model = typeof b.model === 'string' ? b.model : null
          const doc = { id, title, model, ts: Date.now(), messages }
          mkdirSync(CHATS_DIR, { recursive: true })
          writeFileSync(chatPath(id), JSON.stringify(doc))
          const list = index().filter((e) => e.id !== id)
          list.unshift({ id, title, model, ts: doc.ts, n: messages.length })
          const drop = list.splice(CHATS_MAX)
          for (const d of drop) { try { unlinkSync(chatPath(d.id)) } catch { /* già sparito */ } }
          saveIndex(list)
          return json(res, 200, doc)
        } catch (e) {
          return errorJson(res, e)
        }
      })
    }

    // rinomina
    const rm = path.match(/^\/api\/chats\/([^/]+)\/rename$/)
    if (rm && req.method === 'POST') {
      const id = rm[1]
      if (!validId(id)) return json(res, 400, { error: { message: 'id non valido' } })
      const b = await readBody(req)
      const title = String(b.title || '').replace(/\s+/g, ' ').trim()
      if (!title) return json(res, 400, { error: { message: 'titolo mancante' } })
      const list = index()
      const entry = list.find((e) => e.id === id)
      if (!entry) return json(res, 404, { error: { message: 'conversazione non trovata' } })
      entry.title = title
      saveIndex(list)
      try {
        const doc = JSON.parse(readFileSync(chatPath(id), 'utf8'))
        doc.title = title
        writeFileSync(chatPath(id), JSON.stringify(doc))
      } catch { /* file mancante: l'indice resta aggiornato */ }
      return json(res, 200, { ok: true, id, title })
    }

    // elimina (file + indice)
    const dm = path.match(/^\/api\/chats\/([^/]+)\/delete$/)
    if (dm && req.method === 'POST') {
      const id = dm[1]
      if (!validId(id)) return json(res, 400, { error: { message: 'id non valido' } })
      const list = index()
      const next = list.filter((e) => e.id !== id)
      try { unlinkSync(chatPath(id)) } catch { /* già sparito */ }
      saveIndex(next)
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { error: { message: 'endpoint inesistente' } })
  }
}
