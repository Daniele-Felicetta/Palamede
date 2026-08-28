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

export interface ModelInfo {
  id: string
  name: string
  engine: string
  loaded: boolean
}

export interface ModelsStatus {
  current: string | null
  models: ModelInfo[]
  zimage_process: boolean
}

export interface Metrics {
  ts: number
  cpu: number
  ram: { usedGB: number; totalGB: number; pct: number }
  gpu: {
    ok: boolean
    utilPct: number
    vramUsedGB: number
    vramTotalGB: number
    vramPct: number
    tempC: number
    powerW: number
    procs: { name: string; mem: string }[]
  }
}

export interface Health {
  ok: boolean
  current: string | null
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export async function getHealth(): Promise<Health> {
  return j(await fetch('/api/health'))
}

export async function getModels(): Promise<ModelsStatus> {
  return j(await fetch('/api/models'))
}

export async function selectModel(model: string): Promise<ModelsStatus> {
  return j(await fetch('/api/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }))
}

export async function getMetrics(): Promise<Metrics> {
  return j(await fetch('/api/metrics'))
}

export async function generateImage(req: GenRequest): Promise<GenImage[]> {
  const r = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || data?.detail || `HTTP ${r.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data.images as GenImage[]
}