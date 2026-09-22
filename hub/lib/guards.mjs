// Palamede hub — difese anti drive-by / DNS rebinding.
// I servizi ascoltano su 127.0.0.1 ma senza autenticazione: senza queste
// due difese una pagina web malevola aperta nel browser dell'utente può
// chiamare le API (le POST "simple" non fanno preflight CORS).
//   1. allowedHost  — il browser invia SEMPRE l'Host richiesto: se non è
//      loopback la richiesta arriva da un dominio malevolo risolto su
//      127.0.0.1 (DNS rebinding). 403.
//   2. allowedOrigin — il browser invia l'Origin su tutte le fetch e su
//      tutte le POST: se non è l'hub (o il dev server Vite) è una richiesta
//      cross-origin da un sito web. 403.
// I client non-browser (curl, PowerShell, Rust) non inviano Origin e
// restano ammessi: sono processi locali già privilegiati, fuori dal modello
// di minaccia. Residuo documentato in SECURITY.md: probing GET in sola
// lettura via <img>/<script> su URL con id non indovinabili.
export const DEV_ORIGIN_PORT = 5173 // dev server Vite (frontend/vite.config.ts)

export function allowedHost(req) {
  let h = String(req.headers.host || '').toLowerCase()
  if (h.startsWith('[')) { // IPv6 "[::1]:port"
    const m = h.match(/^\[([^\]]+)\]/)
    h = m ? m[1] : h
  } else {
    const i = h.lastIndexOf(':')
    if (i > 0) h = h.slice(0, i)
  }
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

export function allowedOrigin(req, port) {
  const origin = String(req.headers.origin || '').toLowerCase()
  if (!origin) return true
  const ok = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${DEV_ORIGIN_PORT}`,
    `http://localhost:${DEV_ORIGIN_PORT}`,
  ])
  return ok.has(origin)
}
