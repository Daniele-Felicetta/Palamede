// Palamede hub — knowledge base RAG (stile NotebookLM).
// Fonti grezze in knowledge/raw/, indice in knowledge/rag/ (chunks.json).
// Logica di dominio in rag.mjs (chunking/embedding/retrieval) e rerank.mjs
// (MiniCPM dedicato :8125): qui solo le route /api/kb/*.
// Lo stato chat (per la UI) arriva da chat.mjs: niente stato duplicato.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync } from 'node:fs'
import { join, normalize, dirname } from 'node:path'
import { ROOT } from './root.mjs'
import { json, errorJson, readBody } from './http.mjs'
import { textStatus } from './chat.mjs'
import { rerankStatus, startRerank, stopRerank } from './rerank.mjs'
import {
  ensureRag, ensureMigrated, listRaw, listIndexed, missingSources,
  indexSource, removeSource, hybridRetrieve, retrieve, embeddingsInfo,
} from './rag.mjs'

const KB_DIR = join(ROOT, 'knowledge')
const KB_RAW = join(KB_DIR, 'raw')

const MAX_UPLOAD = 300 * 1024

export function ensureKb() {
  ensureRag()
  ensureMigrated()
}

// Path relativo dentro knowledge/ (es. "raw/nota.md"). Rifiuta assoluti,
// "..", backslash e drive Windows.
function kbResolve(rel) {
  if (typeof rel !== 'string' || !rel) return null
  if (rel.includes('\\') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/')) return null
  const abs = normalize(join(KB_DIR, rel))
  if (abs !== KB_DIR && !abs.startsWith(KB_DIR + '\\') && !abs.startsWith(KB_DIR + '/')) return null
  if (rel.split('/').includes('..')) return null
  return abs
}

function kbWalk(dir) {
  const out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const abs = join(dir, name)
    let st = null
    try { st = statSync(abs) } catch { continue }
    if (st.isFile()) out.push({ name, bytes: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function validSourceName(name) {
  return typeof name === 'string' && /^[\w.\- ]+\.(md|txt)$/i.test(name)
}

// Indice dei fonti presenti in raw/ ma non ancora indicizzate, in coda alla
// migrazione (all'avvio del hub). Best-effort: un errore non blocca l'avvio.
function startBackgroundIndex(queued) {
  ensureKb()
  const missing = missingSources()
  if (!missing.length) return
  let i = 0
  const step = async () => {
    if (i >= missing.length) return
    const name = missing[i++]
    try {
      const r = await indexSource(name)
      console.log(`[kb] indicizzata ${name}: ${r.chunks} chunk${r.embedded ? '' : ' (keyword fallback)'}`)
    } catch (e) {
      console.error(`[kb] ingest automatico ${name}: ${e.message}`)
    }
    setTimeout(() => queued(step), 1000)
  }
  queued(step)
}

export function createKbRoutes(queued) {
  ensureKb()
  startBackgroundIndex(queued)

  return async function handleKb(req, res, path) {
    ensureKb()
    const u = new URL(req.url, 'http://localhost')

    if (path === '/api/kb/status' && req.method === 'GET') {
      const indexed = listIndexed()
      const raw = listRaw()
      const chunks = indexed.reduce((a, s) => a + s.chunks, 0)
      const embedded = indexed.reduce((a, s) => a + (s.embedded ? s.chunks : 0), 0)
      return json(res, 200, {
        ok: true,
        raw: raw.length,
        chunks,
        embedded,
        sources: indexed,
        chat: textStatus(),
        embeddings: await embeddingsInfo(),
        rerank: rerankStatus(),
      })
    }

    if (path === '/api/kb/files' && req.method === 'GET') {
      const area = u.searchParams.get('area')
      if (area !== 'raw') return json(res, 400, { error: { message: 'area deve essere raw' } })
      return json(res, 200, { area, files: kbWalk(KB_RAW) })
    }

    if (path === '/api/kb/read' && req.method === 'GET') {
      const rel = u.searchParams.get('path') || ''
      const abs = kbResolve(rel)
      if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
      try {
        const st = statSync(abs)
        if (st.isDirectory()) return json(res, 400, { error: { message: 'è una cartella' } })
        return json(res, 200, { path: rel, content: readFileSync(abs, 'utf8') })
      } catch {
        return json(res, 404, { error: { message: 'file non trovato' } })
      }
    }

    if (path === '/api/kb/save' && req.method === 'POST') {
      const b = await readBody(req)
      const rel = String(b.path || '')
      const content = typeof b.content === 'string' ? b.content : null
      if (content === null) return json(res, 400, { error: { message: 'content mancante' } })
      if (!/^raw\//.test(rel) || !/\.(md|txt)$/i.test(rel)) {
        return json(res, 400, { error: { message: 'path deve essere raw/... (.md/.txt)' } })
      }
      if (content.length > MAX_UPLOAD) return json(res, 400, { error: { message: 'fonte troppo grande (max 300KB)' } })
      const abs = kbResolve(rel)
      if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
      try {
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content)
        return json(res, 200, { ok: true, path: rel })
      } catch (e) {
        return errorJson(res, e)
      }
    }

    if (path === '/api/kb/delete' && req.method === 'POST') {
      const b = await readBody(req)
      const rel = String(b.path || '')
      if (!/^raw\//.test(rel)) return json(res, 400, { error: { message: 'si elimina solo da raw/' } })
      const abs = kbResolve(rel)
      if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
      try { unlinkSync(abs) } catch { return json(res, 404, { error: { message: 'file non trovato' } }) }
      removeSource(rel.slice('raw/'.length))
      return json(res, 200, { ok: true })
    }

    // Upload di una fonte da UI (drag&drop / file): salva in raw/ e la indicizza.
    if (path === '/api/kb/upload' && req.method === 'POST') {
      const b = await readBody(req)
      const name = String(b.name || '')
      const content = typeof b.content === 'string' ? b.content : null
      if (!validSourceName(name)) {
        return json(res, 400, { error: { message: 'nome non valido (solo .md/.txt)' } })
      }
      if (content === null) return json(res, 400, { error: { message: 'content mancante' } })
      if (content.length > MAX_UPLOAD) return json(res, 400, { error: { message: 'fonte troppo grande (max 300KB)' } })
      const abs = kbResolve('raw/' + name)
      if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
      return queued(async () => {
        try {
          writeFileSync(abs, content)
          const r = await indexSource(name)
          return json(res, 200, r)
        } catch (e) {
          return errorJson(res, e)
        }
      })
    }

    // Ingest di una fonte esistente in raw/ (o re-indicizzazione).
    if (path === '/api/kb/ingest' && req.method === 'POST') {
      const b = await readBody(req)
      const source = String(b.source || '').split('/').pop()
      if (!validSourceName(source)) {
        return json(res, 400, { error: { message: 'source deve essere un file .md/.txt in raw/' } })
      }
      const abs = kbResolve('raw/' + source)
      if (!abs || !existsSync(abs)) return json(res, 404, { error: { message: 'fonte non trovata in raw/' } })
      return queued(async () => {
        try {
          return json(res, 200, await indexSource(source))
        } catch (e) {
          return errorJson(res, e)
        }
      })
    }

    // Ricerca ibrida (keyword + vettoriale), per ispezione nella UI.
    if (path === '/api/kb/search' && req.method === 'GET') {
      const q = u.searchParams.get('q') || ''
      const hits = await hybridRetrieve(q, 8)
      return json(res, 200, { query: q, chunks: hits })
    }

    // Retrieval completo (ibrido + rerank MiniCPM): usato dalla chat grounded.
    if (path === '/api/kb/retrieve' && req.method === 'POST') {
      const b = await readBody(req)
      const query = String(b.query || '').trim()
      if (!query) return json(res, 400, { error: { message: 'query mancante' } })
      const k = Math.min(10, Math.max(1, Number(b.topK) || 5))
      const { reranked, hits } = await retrieve(query, k, 20)
      const seen = new Set()
      const sources = []
      for (const h of hits) {
        if (!seen.has(h.source)) {
          seen.add(h.source)
          sources.push({ name: h.source, path: 'raw/' + h.source })
        }
      }
      return json(res, 200, { query, reranked, chunks: hits, sources })
    }

    if (path === '/api/kb/embeddings' && req.method === 'GET') {
      return json(res, 200, await embeddingsInfo())
    }

    // Stato/start/stop del reranker MiniCPM (diagnostica).
    if (path === '/api/kb/rerank' && req.method === 'GET') {
      return json(res, 200, rerankStatus())
    }
    if (path === '/api/kb/rerank/start' && req.method === 'POST') {
      return json(res, 200, { ok: await startRerank(), status: rerankStatus() })
    }
    if (path === '/api/kb/rerank/stop' && req.method === 'POST') {
      stopRerank()
      return json(res, 200, rerankStatus())
    }

    return json(res, 404, { error: { message: 'endpoint inesistente' } })
  }
}