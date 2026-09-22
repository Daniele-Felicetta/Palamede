// Palamede hub — documentazione del progetto (sezione Progetto nella UI).
// Whitelist di file serviti da /api/doc (niente path traversal: solo chiavi).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT, DOC_FILES } from './root.mjs'
import { json } from './http.mjs'

export async function handleDoc(req, res) {
  const name = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '').toLowerCase()
  const file = DOC_FILES[name]
  if (!file) return json(res, 404, { error: { message: 'documento sconosciuto (mappa|readme|spec|security)' } })
  try {
    const text = await readFile(join(ROOT, file), 'utf8')
    return json(res, 200, { name: file, text })
  } catch {
    return json(res, 404, { error: { message: 'documento non trovato' } })
  }
}
