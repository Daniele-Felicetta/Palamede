// Client verso il hub (:4600). Il hub serializza le generazioni su GPU,
// quindi una chiamata = un posto in coda.

export interface GenRequest {
  model: 'bonsai' | 'zimage'
  prompt: string
  steps: number
  seed: number // -1 = casuale
  width: number
  height: number
  count: number
}

export interface GenImage {
  dataUrl: string
  timeMs: number
  seed: number
  params: Record<string, unknown>
}

export interface Health {
  bonsai: { ok: boolean; family?: string | null }
  zimage: { ok: boolean }
}

export async function getHealth(): Promise<Health> {
  const r = await fetch('/api/health')
  if (!r.ok) throw new Error('hub non raggiungibile')
  return r.json()
}

export async function generateImage(req: GenRequest): Promise<GenImage[]> {
  const r = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || `HTTP ${r.status}`
    throw new Error(msg)
  }
  return data.images as GenImage[]
}
