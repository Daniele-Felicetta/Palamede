// Helper HTTP condivisi dai moduli api/*. Gli import pubblici restano da
// '../api' (src/api/index.ts riesporta tutto): nessun cambio nei consumer.
export async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = (data as { error?: { message?: unknown }; detail?: unknown })?.error?.message
      ?? (data as { detail?: unknown })?.detail
      ?? `HTTP ${r.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as T
}
