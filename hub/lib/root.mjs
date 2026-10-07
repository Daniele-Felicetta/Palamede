// Palamede hub — configurazione centrale (env + path).
// Unico punto dove si leggono le porte e si calcolano i path: gli altri
// moduli importano da qui invece di duplicare env/parsing.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
export const ROOT = resolve(__dirname, '..', '..')
export const DIST = join(ROOT, 'frontend', 'dist')

// Chiavi opzionali (es. narratore cloud Gemini) da `.env` nella radice del
// progetto: file gitignored, le variabili d'ambiente di sistema hanno la
// precedenza. Best-effort: se il file manca (o Node è troppo vecchio per
// loadEnvFile) si prosegue con le sole env di sistema.
try {
  const envFile = join(ROOT, '.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
} catch { /* nessun .env: si usano le env di sistema */ }

export const PORT = Number(process.env.PALAMEDE_PORT || 4600)
export const BACKEND = process.env.PALAMEDE_BACKEND || 'http://127.0.0.1:8000'
// TRELLIS.2 (image-to-3D): venv separato su :8124, generazione ~74s
export const TRELLIS = process.env.PALAMEDE_TRELLIS || 'http://127.0.0.1:8124'
export const TRELLIS_PORT = Number(process.env.PALAMEDE_TRELLIS_PORT || 8124)
export const TRELLIS_PY = join(ROOT, 'reference', 'trellis-venv', 'Scripts', 'python.exe')
export const TRELLIS_LOG = join(ROOT, 'outputs', 'trellis-server.log')
// LM Studio (OpenAI-compatible :1234): modelli vision-language per le storie
export const LMSTUDIO = process.env.PALAMEDE_LMSTUDIO || 'http://127.0.0.1:1234'

// ── build di llama.cpp ────────────────────────────────────────────────────
// setup.ps1 installa b11457 in tools/llama-cpp. Sulle macchine che hanno
// anche una build più recente affiancata (tools/llama-cpp-<tag>) si preferisce
// quella: lo spec-decode MTP di Darwin richiede >= b11048, e su b10648 il
// draft non carica ("tensor 'output_hc_norm.weight' not found"). Override
// esplicito con PALAMEDE_LLAMA_DIR. Tutti i moduli che lanciano un binario di
// llama.cpp passano di qui, altrimenti chat e rerank possono finire su build
// diverse nella stessa sessione.
const LLAMA_DIR_CANDIDATES = [
  process.env.PALAMEDE_LLAMA_DIR,
  join(ROOT, 'tools', 'llama-cpp-b11457'),
  join(ROOT, 'tools', 'llama-cpp'),
].filter(Boolean)

export const LLAMA_DIR =
  LLAMA_DIR_CANDIDATES.find((d) => existsSync(join(d, 'llama-server.exe')))
  ?? LLAMA_DIR_CANDIDATES.at(-1)

/** Percorso di un binario della build scelta, o null se non c'è. */
export function llamaBin(name) {
  const p = join(LLAMA_DIR, name)
  return existsSync(p) ? p : null
}

// documenti serviti alla sezione Progetto della UI (whitelist: niente path traversal)
export const DOC_FILES = { mappa: 'MAPPA.md', readme: 'README.md', spec: 'SPEC.md', security: 'SECURITY.md' }

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.stl': 'model/stl',
  '.webmanifest': 'application/manifest+json',
}
