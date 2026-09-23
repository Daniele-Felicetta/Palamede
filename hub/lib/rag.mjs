// Palamede hub — RAG vettoriale (stile NotebookLM).
// Fonti in knowledge/raw/, indice in knowledge/rag/chunks.json (un solo file
// JSON, riscritto atomicamente a ogni ingest). Embedding via Ollama locale
// (embeddinggemma, /api/embed), retrieval ibrido coseno + BM25 fusi con RRF,
// rerank opzionale via rerank.mjs (llama-server MiniCPM dedicato :8123).
// Zero dipendenze npm: chunking, BM25 e coseno sono hand-rolled.
//
// API (consumate da kb.mjs):
//   ensureRag()            — crea knowledge/{raw,rag}/
//   ensureMigrated()       — rimuove il vecchio pattern llm-wiki (wiki/, index.md…)
//   listRaw()              — file in raw/ (nome, bytes, mtime)
//   getStore()             — { sources: {...}, chunks: [...] }
//   indexSource(name)      — chunk+embed+salva una fonte → { chunks, embedded, fallbackKeyword }
//   removeSource(name)     — elimina i chunk e la voce di una fonte
//   hybridRetrieve(q, n)   — retrieval ibrido → hits ordinati per RRF
//   retrieve(q, n)         — hybridRetrieve + rerank MiniCPM → { reranked, hits }
//   embeddingsInfo()       — stato Ollama: { available, models }

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { rerankChunks } from './rerank.mjs'

const KB_DIR = join(ROOT, 'knowledge')
const KB_RAW = join(KB_DIR, 'raw')
const RAG_DIR = join(KB_DIR, 'rag')
const RAG_FILE = join(RAG_DIR, 'chunks.json')

const OLLAMA = 'http://127.0.0.1:11434'
const EMB_MODEL = 'embeddinggemma'

// ── parametri di chunking ─────────────────────────────────────────────────
const TARGET = 600      // dimensione target di un chunk (caratteri)
const MAX = 900         // oltre: chiudi il chunk
const OVERLAP = 150     // coda massima portata nel chunk successivo

// ── store ─────────────────────────────────────────────────────────────────

function emptyStore() {
  return { version: 1, sources: {}, chunks: [] }
}

export function ensureRag() {
  mkdirSync(KB_RAW, { recursive: true })
  mkdirSync(RAG_DIR, { recursive: true })
  if (!existsSync(RAG_FILE)) saveStore(emptyStore())
}

// Elimina i resti del pattern llm-wiki (wiki/, index.md, log.md, SCHEMA.md):
// migrazione una-tantum, best-effort (la cartella è gitignored).
export function ensureMigrated() {
  for (const p of [join(KB_DIR, 'wiki'), join(KB_DIR, 'index.md'), join(KB_DIR, 'log.md'), join(KB_DIR, 'SCHEMA.md')]) {
    try { rmSync(p, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}

function loadStore() {
  try { return JSON.parse(readFileSync(RAG_FILE, 'utf8')) } catch { return emptyStore() }
}

function saveStore(store) {
  const tmp = RAG_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(store))
  renameSync(tmp, RAG_FILE)
}

export function getStore() {
  ensureRag()
  return loadStore()
}

// ── fonti ─────────────────────────────────────────────────────────────────

export function listRaw() {
  const out = []
  let entries = []
  try { entries = readdirSync(KB_RAW) } catch { return out }
  for (const name of entries) {
    const abs = join(KB_RAW, name)
    let st = null
    try { st = statSync(abs) } catch { continue }
    if (st.isFile()) out.push({ name, bytes: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function slug(name) {
  return name.replace(/\.(md|txt)$/i, '').replace(/[^\w\-]+/g, '-').toLowerCase()
}

function hashId(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12)
}

// ── chunking ──────────────────────────────────────────────────────────────

// Suddivide il testo in paragrafi (le righe vuote staccano) mantenendo gli
// offset assoluti nel file originale: servono per evidenziare il chunk nella
// fonte. Poi impacchetta i paragrafi in chunk da TARGET–MAX caratteri,
// portando nel chunk successivo la coda di quello chiuso (overlap).
export function chunkText(text) {
  const lines = text.split(/\r?\n/)
  const segs = []
  let pos = 0
  let segStart = -1
  let buf = ''
  const push = () => {
    if (buf.trim()) {
      const rel = buf.search(/\S/)
      const trimmed = buf.trimEnd()
      segs.push({ text: trimmed, start: segStart + rel, end: segStart + rel + trimmed.length })
    }
    buf = ''
    segStart = -1
  }
  for (const line of lines) {
    if (!line.trim()) {
      push()
    } else {
      if (segStart === -1) segStart = pos
      buf += (buf ? '\n' : '') + line
    }
    pos += line.length + 1
  }
  push()

  const chunks = []
  let cur = []
  let curLen = 0
  let section = ''
  let curSection = ''
  const flush = () => {
    if (!cur.length) return
    const start = cur[0].start
    const end = cur[cur.length - 1].end
    const body = cur.map((s) => s.text).join('\n')
    chunks.push({ section: curSection, text: body, start, end })
    // overlap: porta la coda dell'ultima frase nel chunk successivo
    const tail = carryTail(body)
    if (tail.len >= 40) {
      cur = [{ text: tail.text, start: end - tail.len, end }]
      curLen = tail.len
      curSection = section
    } else {
      cur = []
      curLen = 0
      curSection = ''
    }
  }
  for (const s of segs) {
    const h = s.text.match(/^(#{1,6})\s+(.*)$/)
    if (h) section = h[2]
    if (curLen && curLen + s.text.length > MAX) flush()
    if (!cur.length) curSection = section
    cur.push(s)
    curLen += s.text.length + 1
  }
  flush()
  return chunks
}

// Coda del chunk (max OVERLAP caratteri) per l'overlap: preferisce partire da
// un confine di frase, ma garantisce comunque una coda abbastanza lunga.
function carryTail(body) {
  const win = Math.min(OVERLAP, body.length)
  const tail = body.slice(-win)
  let best = -1
  for (let i = tail.length - 2; i >= 20; i--) {
    if ('.!?'.includes(tail[i]) && /\s/.test(tail[i + 1] ?? '')) { best = i; break }
  }
  if (best >= 0 && tail.length - best - 1 >= 40) {
    return { text: tail.slice(best + 1), len: tail.length - best - 1 }
  }
  return { text: tail, len: tail.length }
}

// ── embedding Ollama ──────────────────────────────────────────────────────

let embModel = null
async function discoverEmbedModel() {
  if (embModel) return embModel
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    const j = await r.json()
    const names = (j.models || []).map((m) => m.name || m.model)
    embModel = names.find((n) => /embed/i.test(n)) || names.find((n) => n.includes('gemma')) || null
  } catch { embModel = null }
  return embModel
}

export function resetEmbedModel() { embModel = null }

// Embedding di un batch di testi → array di vettori o null (Ollama giù).
async function embedBatch(texts) {
  const model = await discoverEmbedModel()
  if (!model) return null
  try {
    const r = await fetch(OLLAMA + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) throw new Error('ollama embed ' + r.status)
    const j = await r.json()
    const vecs = j?.embeddings
    return Array.isArray(vecs) && vecs.length === texts.length ? vecs : null
  } catch { return null }
}

export async function embeddingsInfo() {
  try {
    const model = await discoverEmbedModel()
    return { available: !!model, models: model ? [model] : [] }
  } catch {
    return { available: false, models: [] }
  }
}

// ── ingest di una fonte ───────────────────────────────────────────────────

// Chunk + embed + salva una fonte di raw/. Idempotente: ricrea i chunk della
// fonte (cancella i precedenti). Se Ollama è giù i chunk restano senza vettore
// (vec: null) e la ricerca degrada a keyword: un nuovo ingest li ri-embedda.
export async function indexSource(name) {
  ensureRag()
  const abs = join(KB_RAW, name)
  if (!existsSync(abs)) throw new Error('fonte non trovata in raw/')
  const raw = readFileSync(abs, 'utf8')
  if (raw.length > 300 * 1024) throw new Error('fonte troppo grande (max 300KB)')

  const store = loadStore()
  const before = (store.sources[name]?.chunks) || 0
  store.chunks = store.chunks.filter((c) => c.source !== name)

  const parsed = chunkText(raw)
  const texts = parsed.map((c) => c.text)
  const vecs = await embedBatch(texts)
  const embedded = !!vecs

  const newChunks = parsed.map((c, i) => ({
    id: hashId(name, c.start, c.end, i),
    source: name,
    section: c.section,
    text: c.text,
    start: c.start,
    end: c.end,
    vec: vecs ? vecs[i] : null,
  }))
  store.chunks.push(...newChunks)
  store.sources[name] = {
    slug: slug(name),
    bytes: raw.length,
    chunks: newChunks.length,
    embedded,
    updated: Date.now(),
  }
  saveStore(store)

  return { source: name, chunks: newChunks.length, embedded, fallbackKeyword: !embedded, replaced: before }
}

// Elimina fonte + chunk + voce dall'indice. Non tocca il file in raw/ (lo
// cancella il chiamante se serve).
export function removeSource(name) {
  const store = loadStore()
  store.chunks = store.chunks.filter((c) => c.source !== name)
  delete store.sources[name]
  saveStore(store)
}

// Fonti indicizzate (con i conteggi dello store).
export function listIndexed() {
  const store = loadStore()
  return Object.entries(store.sources).map(([name, s]) => ({
    name,
    slug: s.slug,
    bytes: s.bytes,
    chunks: s.chunks,
    embedded: !!s.embedded,
    updated: s.updated,
  }))
}

// Fonti presenti in raw/ ma non ancora indicizzate.
export function missingSources() {
  const store = loadStore()
  return listRaw().filter((f) => !store.sources[f.name]).map((f) => f.name)
}

// ── retrieval ibrido ──────────────────────────────────────────────────────

function tokenize(s) {
  return s.toLowerCase().split(/[^a-z0-9à-ÿ]+/i).filter((t) => t.length >= 2)
}

function cosine(a, b) {
  if (!a || !b) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// BM25-lite: idf dai conteggi di documento globali, k1=1.5, b=0.75.
function bm25Scores(query, chunks) {
  const qterms = [...new Set(tokenize(query))]
  if (!qterms.length) return new Map()
  const N = chunks.length
  const df = new Map()
  const lens = []
  const tfs = chunks.map(() => new Map())
  for (const c of chunks) {
    const toks = tokenize(c.text)
    lens.push(toks.length)
    const seen = new Set()
    for (const t of toks) {
      tfs[tfs.length - 1]?.set(t, (tfs[tfs.length - 1]?.get(t) || 0) + 1)
      if (!seen.has(t)) { seen.add(t); df.set(t, (df.get(t) || 0) + 1) }
    }
  }
  const avgdl = lens.reduce((a, b) => a + b, 0) / (N || 1)
  const out = new Map()
  for (let i = 0; i < N; i++) {
    const dlen = lens[i]
    let score = 0
    for (const t of qterms) {
      const tf = tfs[i]?.get(t) || 0
      if (!tf) continue
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5))
      score += idf * ((tf * (1.5 + 1)) / (tf + 1.5 * (1 - 0.75 + 0.75 * (dlen / avgdl))))
    }
    out.set(i, score)
  }
  return out
}

// Fusi i due ranking (coseno + BM25) con RRF: robusto a scale diverse.
function rrf(rankings, k = 60) {
  const fused = new Map()
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      fused.set(id, (fused.get(id) || 0) + 1 / (k + rank))
    })
  }
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

// Retrieval ibrido: coseno + BM25 → top n. I chunk senza vettore pesano solo
// sul BM25. Ritorna hit arricchiti con i metadati per la citazione.
export async function hybridRetrieve(query, n = 20) {
  const store = loadStore()
  const chunks = store.chunks
  if (!chunks.length) return []

  const cosineRank = []
  if (chunks.some((c) => c.vec)) {
    const e = await awaitQueryEmbed(query)
    if (e) {
      const byCos = []
      for (const c of chunks) if (c.vec) byCos.push([c.id, cosine(c.vec, e)])
      byCos.sort((a, b) => b[1] - a[1])
      cosineRank.push(...byCos.map(([id]) => id))
    }
  }

  const bm = bm25Scores(query, chunks)
  const byBm = [...bm.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => chunks[i].id)

  const fused = rrf([cosineRank, byBm])
  const byId = new Map(chunks.map((c) => [c.id, c]))
  return fused.slice(0, n).map((id) => {
    const c = byId.get(id)
    return {
      id: c.id, source: c.source, section: c.section, text: c.text,
      start: c.start, end: c.end, score: bm.get(chunks.indexOf(c)) || 0,
    }
  })
}

let qembCache = { q: '', vec: null }
async function awaitQueryEmbed(query) {
  if (qembCache.q === query) return qembCache.vec
  const model = await discoverEmbedModel()
  if (!model) return null
  try {
    const r = await fetch(OLLAMA + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: query }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return null
    const j = await r.json()
    const v = j?.embeddings?.[0] || null
    qembCache = { q: query, vec: v }
    return v
  } catch { return null }
}

// Retrieval completo: ibrido + rerank MiniCPM (se disponibile). Il rerank è
// best-effort: se il reranker è giù o in caricamento, restano i top ibridi.
export async function retrieve(query, topK = 5, candidates = 20) {
  const hits = await hybridRetrieve(query, candidates)
  if (!hits.length) return { reranked: false, hits: [] }
  const rerankedIds = await rerankChunks(query, hits.map((h) => ({ id: h.id, text: h.text })))
  if (!rerankedIds) return { reranked: false, hits: hits.slice(0, topK) }
  const byId = new Map(hits.map((h) => [h.id, h]))
  const ordered = rerankedIds.map((id) => byId.get(id)).filter(Boolean)
  const seen = new Set(ordered.map((h) => h.id))
  for (const h of hits) if (!seen.has(h.id)) ordered.push(h)
  return { reranked: true, hits: ordered.slice(0, topK) }
}