// Router hash-based: niente dipendenze. Le route sono già "sicure" per file
// statici serviti dal hub (nessun rewrite server-side richiesto).
//
// In Svelte 5 lo stato reattivo condiviso vive in un file .svelte.ts: `route`
// è un oggetto $state, `navigate()` è il punto unico di cambio route.

function read(): string {
  return (typeof window !== 'undefined' ? location.hash.replace(/^#/, '') : '/') || '/'
}

export const route = $state({ path: read() })

export function navigate(to: string): void {
  if (typeof window !== 'undefined') location.hash = to
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => { route.path = read() })
}