// Palamede hub — proxy streaming generico (SSE pass-through byte per byte).
// chat (llama-server) e lmstudio (LM Studio) condividevano lo stesso rituale
// data/end/pipe/error: ora sta qui, parametrizzato su host/porta/path.

import { request as httpRequest } from 'node:http'
import { json } from './http.mjs'

// Timeout di INATTIVITA' sull'upstream: NON limita la durata totale di una
// generazione lunga (lo stream di token tiene vivo il socket), ma sblocca la
// richiesta se llama-server/LM Studio non danno segni di vita.
const STALL_TIMEOUT_MS = 180_000

export function proxyStream(req, res, { host, port, path, method, accept, defaultType, errorMessage }) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const preq = httpRequest({
      host, port, path,
      method: method || req.method,
      timeout: STALL_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        ...(body.length ? { 'Content-Length': body.length } : {}),
        Accept: accept,
      },
    }, (pres) => {
      res.writeHead(pres.statusCode || 200, {
        'Content-Type': pres.headers['content-type'] || defaultType || accept.split(',')[0].trim(),
        'Cache-Control': 'no-store',
      })
      pres.pipe(res)
    })
    preq.on('timeout', () => {
      preq.destroy(new Error(`nessuna risposta da ${host}:${port} entro ${STALL_TIMEOUT_MS / 1000}s`))
    })
    preq.on('error', (e) => {
      if (!res.headersSent) {
        json(res, 502, { error: { message: `${errorMessage} (${e.message})` } })
      } else {
        res.end()
      }
    })
    preq.end(body)
  })
  req.on('error', () => res.end())
}
