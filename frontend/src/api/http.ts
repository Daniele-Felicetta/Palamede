// Helper HTTP condivisi dai moduli api/*. Gli import pubblici restano da
// '../api' (src/api/index.ts riesporta tutto): nessun cambio nei consumer.

/** Messaggio d'errore del backend: `{error:{message}}` (hub) o `{detail}`
 *  (proxy FastAPI). Fallback: `HTTP <status>`. */
async function errMsg(r: Response): Promise<string> {
  const data = (await r.json().catch(() => null)) as
    | { error?: { message?: unknown }; detail?: unknown }
    | null
  const msg = data?.error?.message ?? data?.detail
  return typeof msg === 'string' ? msg : msg ? JSON.stringify(msg) : `HTTP ${r.status}`
}

export async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(await errMsg(r))
  return r.json() as Promise<T>
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await errMsg(r))
  return r.json() as Promise<T>
}
