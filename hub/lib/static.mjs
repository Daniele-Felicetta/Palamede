// Palamede hub — file statici (frontend/dist) con fallback SPA.
// index.html mai in cache (punta a bundle con hash, la shell va rivista);
// gli asset con hash restano cacheabili dal browser.

import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { DIST, MIME } from './root.mjs'
import { json } from './http.mjs'

export async function serveStatic(res, path) {
  let file = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  if (file === '') file = 'index.html'
  const isHtml = extname(file).toLowerCase() === '.html'
  const abs = join(DIST, file)
  if (!abs.startsWith(DIST)) {
    return json(res, 403, { error: { message: 'forbidden' } })
  }
  try {
    const s = await stat(abs)
    if (s.isDirectory()) throw new Error('dir')
    const data = await readFile(abs)
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      // index.html mai in cache: punta a bundle con hash, la shell va rivista
      ...(isHtml ? { 'Cache-Control': 'no-cache' } : {}),
    })
    res.end(data)
  } catch {
    try {
      const idx = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Length': idx.length,
        'Cache-Control': 'no-cache',
      })
      res.end(idx)
    } catch {
      json(res, 404, { error: { message: 'frontend non costruito: npm run build in frontend/' } })
    }
  }
}
