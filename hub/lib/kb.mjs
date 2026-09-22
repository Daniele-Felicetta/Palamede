// Palamede hub — knowledge base llm-wiki (pattern Karpathy: raw/ → wiki/).
// Le fonti grezze stanno in knowledge/raw/, il modello le compila in pagine
// markdown in knowledge/wiki/ con index.md e log.md. Ricerca keyword
// (zero dipendenze); niente embeddings a questa scala.
// Lo stato chat (gate dell'ingest) arriva da chat.mjs: niente stato duplicato.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { join, normalize, dirname } from 'node:path'
import { ROOT } from './root.mjs'
import { json, readBody } from './http.mjs'
import { textStatus, isChatReady, TEXT_PORT } from './chat.mjs'

const KB_DIR = join(ROOT, 'knowledge')
const KB_RAW = join(KB_DIR, 'raw')
const KB_WIKI = join(KB_DIR, 'wiki')
const KB_INDEX = join(KB_DIR, 'index.md')
const KB_LOG = join(KB_DIR, 'log.md')
const KB_SCHEMA = join(KB_DIR, 'SCHEMA.md')

const KB_SCHEMA_SEED = `# Schema della wiki (llm-wiki)

Sei il manutentore della knowledge base di Palamede. Segui queste regole.

## Struttura

- knowledge/raw/ — fonti grezze (leggi, non modificare)
- knowledge/wiki/ — pagine compilate da te: wiki/sources/ (una pagina per fonte),
  wiki/concepts/ (concetti trasversali), wiki/entities/ (entità rilevanti)
- knowledge/index.md — indice: ogni pagina con link e una riga di sintesi
- knowledge/log.md — registro append-only di cosa hai fatto e quando

## Come compilare una fonte (ingest)

1. Leggi la fonte in raw/.
2. Crea wiki/sources/<slug>.md: una pagina di sintesi con i punti chiave,
   citando la fonte e i concetti coinvolti.
3. Aggiorna o crea pagine concept/entity quando la fonte introduce concetti
   nuovi o contraddice pagine esistenti (segnala le contraddizioni!).
4. Aggiorna index.md: aggiungi le pagine nuove e aggiorna le sintesi.
5. Appendi una riga al log.md nel formato:
   ## [AAAA-MM-GG] ingest | <nome fonte>

## Stile delle pagine

- Markdown pulito, collegamenti [[wikilink]] tra pagine dove serve.
- Ogni pagina inizia con: # Titolo, poi una riga di sintesi in corsivo.
- Fatti e misure vanno attribuiti alla fonte (es. "secondo <fonte>").
- Niente inventato: se una cosa non è nella fonte, non scriverla.

## Formato di output

Quando ti viene chiesto un ingest, rispondi SOLO con questo formato
(niente testo fuori dai blocchi):

<<<FILE wiki/sources/<slug>.md>>>
<contenuto della pagina, markdown>
<<<END>>>

... (un blocco <<<FILE>>> per ogni pagina creata/aggiornata) ...

<<<INDEX>>>
<index.md COMPLETO aggiornato>
<<<END>>>

<<<LOG>>>
## [AAAA-MM-GG] ingest | <nome fonte>
<<<END>>>
`

export function ensureKb() {
  mkdirSync(KB_RAW, { recursive: true })
  mkdirSync(KB_WIKI, { recursive: true })
  if (!existsSync(KB_INDEX)) writeFileSync(KB_INDEX, '# Indice della wiki\n\n_Ancora vuota: aggiungi fonti in raw/ e compilale._\n')
  if (!existsSync(KB_LOG)) writeFileSync(KB_LOG, '# Registro della wiki\n')
  if (!existsSync(KB_SCHEMA)) writeFileSync(KB_SCHEMA, KB_SCHEMA_SEED)
}

function kbReadSafe(abs, fallback = '') {
  try { return readFileSync(abs, 'utf8') } catch { return fallback }
}

// Path relativo dentro knowledge/ (es. "raw/nota.md", "wiki/sources/x.md",
// "index.md"). Rifiuta assoluti, "..", backslash e drive Windows.
function kbResolve(rel) {
  if (typeof rel !== 'string' || !rel) return null
  if (rel.includes('\\') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/')) return null
  const abs = normalize(join(KB_DIR, rel))
  if (abs !== KB_DIR && !abs.startsWith(KB_DIR + '\\') && !abs.startsWith(KB_DIR + '/')) return null
  if (rel.split('/').includes('..')) return null
  return abs
}

function kbWalk(dir, base = '') {
  const out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const abs = join(dir, name)
    let st = null
    try { st = statSync(abs) } catch { continue }
    const rel = base ? `${base}/${name}` : name
    if (st.isDirectory()) out.push(...kbWalk(abs, rel))
    else out.push({ name: rel, bytes: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function kbSearchPages(query, limit = 8) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9à-ÿ_]+/i).filter((t) => t.length >= 2)
  if (!terms.length) return []
  const files = kbWalk(KB_WIKI).filter((f) => f.name.endsWith('.md'))
  const scored = []
  for (const f of files) {
    const text = kbReadSafe(join(KB_WIKI, ...f.name.split('/'))).toLowerCase()
    // peso per lunghezza del termine: i termini lunghi (specifici) valgono di più
    let score = 0
    for (const t of terms) {
      let count = 0, idx = text.indexOf(t)
      while (idx !== -1 && count < 50) { count++; idx = text.indexOf(t, idx + t.length) }
      score += count * t.length
    }
    if (score > 0) scored.push({ path: f.name, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.path)
}

function parseIngestBlocks(text) {
  const files = []
  const fileRe = /<<<FILE\s+([^>]+)>>>([\s\S]*?)<<<END>>>/g
  let m
  while ((m = fileRe.exec(text)) !== null) {
    files.push({ path: m[1].trim(), content: m[2].replace(/^\r?\n/, '') })
  }
  const indexM = text.match(/<<<INDEX>>>([\s\S]*?)<<<END>>>/)
  const logM = text.match(/<<<LOG>>>([\s\S]*?)<<<END>>>/)
  return { files, index: indexM ? indexM[1].replace(/^\r?\n/, '') : null, log: logM ? logM[1].trim() : null }
}

function isWikiMarkdown(rel) {
  return /^wiki\//.test(rel) && /\.md$/i.test(rel)
}

function writeWikiFile(rel, content, written) {
  const abs = kbResolve(rel)
  if (!abs) return
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  written.push(rel)
}

export function createKbRoutes(queued) {
  return async function handleKb(req, res, path) {
    ensureKb()
    const u = new URL(req.url, 'http://localhost')

    if (path === '/api/kb/status' && req.method === 'GET') {
      const raw = kbWalk(KB_RAW).length
      const wiki = kbWalk(KB_WIKI).filter((f) => f.name.endsWith('.md')).length
      return json(res, 200, {
        ok: true, raw, wiki,
        index: kbReadSafe(KB_INDEX), log: kbReadSafe(KB_LOG), schema: kbReadSafe(KB_SCHEMA),
        chat: textStatus(),
      })
    }

    if (path === '/api/kb/files' && req.method === 'GET') {
      const area = u.searchParams.get('area')
      if (area !== 'raw' && area !== 'wiki') return json(res, 400, { error: { message: 'area deve essere raw|wiki' } })
      const dir = area === 'raw' ? KB_RAW : KB_WIKI
      return json(res, 200, { area, files: kbWalk(dir) })
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
      if (!/^(raw|wiki)\//.test(rel) || !/\.(md|txt)$/i.test(rel)) {
        return json(res, 400, { error: { message: 'path deve essere raw/... o wiki/... (.md/.txt)' } })
      }
      const abs = kbResolve(rel)
      if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
      try {
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content)
        return json(res, 200, { ok: true, path: rel })
      } catch (e) {
        return json(res, 500, { error: { message: e.message } })
      }
    }

    if (path === '/api/kb/delete' && req.method === 'POST') {
      const b = await readBody(req)
      const rel = String(b.path || '')
      if (!/^raw\//.test(rel)) return json(res, 400, { error: { message: 'si elimina solo da raw/' } })
      const abs = kbResolve(rel)
      if (!abs) return json(res, 403, { error: { message: 'path non ammesso' } })
      try { unlinkSync(abs) } catch { return json(res, 404, { error: { message: 'file non trovato' } }) }
      return json(res, 200, { ok: true })
    }

    if (path === '/api/kb/search' && req.method === 'GET') {
      const q = u.searchParams.get('q') || ''
      return json(res, 200, { query: q, pages: kbSearchPages(q) })
    }

    if (path === '/api/kb/embeddings' && req.method === 'GET') {
      // Ollama locale (opzionale): se espone embeddinggemma, la UI lo segnala
      // come pronto per il futuro RAG vettoriale. Ricerca resta keyword.
      try {
        const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })
        if (!r.ok) throw new Error('ollama ' + r.status)
        const j = await r.json()
        const models = (j.models || []).map((m) => m.name || m.model).filter(Boolean)
        const emb = models.filter((n) => /embed/i.test(n))
        return json(res, 200, { available: emb.length > 0, models: emb.length ? emb : models })
      } catch {
        return json(res, 200, { available: false, models: [] })
      }
    }

    if (path === '/api/kb/ingest' && req.method === 'POST') {
      const b = await readBody(req)
      const source = String(b.source || '').split('/').pop()
      if (!source || !/^[\w.\- ]+\.(md|txt)$/i.test(source)) {
        return json(res, 400, { error: { message: 'source deve essere un file .md/.txt in raw/' } })
      }
      const srcAbs = kbResolve('raw/' + source)
      if (!srcAbs || !existsSync(srcAbs)) return json(res, 404, { error: { message: 'fonte non trovata in raw/' } })
      if (!isChatReady()) {
        return json(res, 409, { error: { message: 'server chat spento: avvialo dalla pagina Chat prima di compilare' } })
      }
      return queued(async () => {
        try {
          const fonte = readFileSync(srcAbs, 'utf8').slice(0, 12000)
          const schema = kbReadSafe(KB_SCHEMA, KB_SCHEMA_SEED)
          const index = kbReadSafe(KB_INDEX).slice(0, 4000)
          const system = `${schema}\n\nFonte da compilare (knowledge/raw/${source}):\n${fonte}\n\nIndice attuale:\n${index}`
          const r = await fetch(`http://127.0.0.1:${TEXT_PORT}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: `Compila la fonte "${source}" nella wiki. Rispondi SOLO coi blocchi <<<FILE>>>/<<<INDEX>>>/<<<LOG>>>.` },
              ],
              stream: false, temperature: 0.3,
            }),
            signal: AbortSignal.timeout(600_000),
          })
          if (!r.ok) throw new Error(`llama-server: HTTP ${r.status}`)
          const j = await r.json()
          const out = j?.choices?.[0]?.message?.content || ''
          const { files, index: newIndex, log: newLog } = parseIngestBlocks(out)
          const written = []
          if (!files.length || newIndex === null) {
            // formato non rispettato: salva il grezzo per ispezione, con errore esplicito
            const slug = source.replace(/\.(md|txt)$/i, '').replace(/[^\w\-]+/g, '-').toLowerCase()
            writeWikiFile(`wiki/sources/${slug}-raw.md`,
              `# ${source} (grezzo, formato ingest non rispettato)\n\n Risposta grezza del modello:\n\n${out}\n`, written)
            return json(res, 200, { ok: false, written, error: 'il modello non ha rispettato il formato: risposta salvata come grezzo' })
          }
          for (const f of files) {
            const rel = f.path.replace(/^knowledge\//, '').replace(/\\/g, '/')
            if (!isWikiMarkdown(rel)) continue
            writeWikiFile(rel, f.content, written)
          }
          if (newIndex !== null) { writeFileSync(KB_INDEX, newIndex); written.push('index.md') }
          if (newLog) { appendFileSync(KB_LOG, '\n' + newLog + '\n'); written.push('log.md') }
          return json(res, 200, { ok: true, written })
        } catch (e) {
          return json(res, 500, { error: { message: e.message } })
        }
      })
    }

    return json(res, 404, { error: { message: 'endpoint inesistente' } })
  }
}
