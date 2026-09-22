// Palamede hub — primitive HTTP condivise (JSON + proxy + body).
// Zero dipendenze (node:http/fetch nativi). Importato da server.mjs e dai
// moduli di dominio (history/kb/chat/trellis).

// Le risposte /api sono sempre fresche: mai in cache (niente metriche o
// stati modello stantii nel browser).
export function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

// Il body pass-through è già JSON: se per qualche motivo non lo fosse, non
// rompiamo la risposta con un JSON.stringify di un testo non-json.
export function safeJson(text) {
  try { return JSON.parse(text) } catch { return { raw: text } }
}

export async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 30 * 1024 * 1024) throw new Error('body troppo grande (max 30MB)')
    chunks.push(c)
  }
  // strip BOM UTF-8 e spazi: JSON.parse non li tollera
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim()
  try { return JSON.parse(text) } catch { return {} }
}

// Proxy JSON verso un backend con timeout esplicito e 502 tipizzato se il
// backend è giù (invece di lasciare la richiesta appesa / crashare il router).
export async function proxyJson(req, res, targetPath, timeoutMs, base) {
  let body = null
  if (req.method === 'POST') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    body = Buffer.concat(chunks)
  }
  try {
    const r = await fetch(base + targetPath, {
      method: req.method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await r.text()
    json(res, r.status, safeJson(text))
  } catch (e) {
    json(res, 502, { error: { message: `backend non raggiungibile (${e.message || e})` } })
  }
}
