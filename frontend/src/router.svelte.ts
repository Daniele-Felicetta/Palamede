// Router hash-based: niente dipendenze. Le route sono già "sicure" per file
// statici serviti dal hub (nessun rewrite server-side richiesto).
//
// In Svelte 5 lo stato reattivo condiviso vive in un file .svelte.ts: `route`
// è un oggetto $state, `navigate()` è il punto unico di cambio route.
//
// Normalizzazione: niente trailing slash (salvo root), niente query/hash
// residui — `/chat/`, `/chat?x=1` e `/chat` sono la stessa rotta.

/** Riporta un path grezzo alla forma canonica (`/chat/…` → `/chat`). */
export function normalize(path: string): string {
  let p = (path || '').split('?')[0].split('#')[0].trim()
  if (!p.startsWith('/')) p = '/' + p
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p || '/'
}

function read(): string {
  if (typeof window === 'undefined') return '/'
  return normalize(location.hash.replace(/^#/, '') || '/')
}

export const route = $state({ path: read() })

export function navigate(to: string): void {
  const next = normalize(to)
  // Aggiorna subito lo stato (la UI reagisce senza aspettare l'evento
  // hashchange) e allinea l'hash; se siamo già lì, torna in cima.
  if (route.path === next) {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
    return
  }
  route.path = next
  if (typeof window !== 'undefined' && location.hash !== '#' + next) location.hash = next
}

// Titoli per scheda/browser: una mappa per le route fisse, fallback per le
// dinamiche di Bandersketch e le bozze.
const TITLES: Record<string, string> = {
  '/': 'Officina',
  '/images': 'Immagini',
  '/chat': 'Chat',
  '/downloader': 'Scarica',
  '/3d': '3D',
  '/server': 'Server',
  '/rag': 'RAG',
  '/extra': 'Extra',
  '/progetto': 'Progetto',
  '/bench': 'Banco',
  '/experimental': 'Experimental',
  '/observatory': 'Osservatorio',
  '/games': 'Giochi',
  '/swarm': 'Stormo di agenti',
  '/bandersketch': 'Bandersketch',
}

export function titleFor(path: string): string {
  const direct = TITLES[path]
  if (direct) return `Palamede · ${direct}`
  const game = path.match(/^\/bandersketch\/(.+)$/)
  if (game) return `Palamede · Bandersketch — ${decodeURIComponent(game[1])}`
  return 'Palamede · pagina non trovata'
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => { route.path = read() })
}