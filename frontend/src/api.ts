// Client verso il hub (:4600). Il hub serializza le generazioni su GPU,
// quindi una chiamata = un posto in coda.

export interface GenRequest {
  model: 'bonsai' | 'zimage' | 'klein'
  prompt: string
  steps: number
  seed: number // -1 = casuale
  width: number
  height: number
  count: number
  image?: string // dataUrl: image-to-image (modelli sd-server)
  strength?: number // forza del denoise in img2img (0.05–1)
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

// ── chat locale (llama.cpp llama-server via hub) ──────────────────────────

export interface ChatModelInfo {
  id: string
  name: string
  moe: boolean
}

export interface ChatParams {
  context: number
  kv: string
  mtp: boolean
  cpuMoe: number
  gpuLayers: number
}

export interface ChatStatus {
  running: boolean
  ready: boolean
  model: string | null
  params: ChatParams | null
  pid: number | null
  models: ChatModelInfo[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function getChatStatus(): Promise<ChatStatus> {
  return j(await fetch('/api/chat/status'))
}

export async function startChat(p: ChatParams & { model: string }): Promise<ChatStatus> {
  const r = await fetch('/api/chat/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || `HTTP ${r.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

export async function stopChat(): Promise<ChatStatus> {
  return j(await fetch('/api/chat/stop', { method: 'POST' }))
}

/** Chiamata streaming: restituisce lo stream SSE del hub. */
export async function chatStream(messages: ChatMessage[], temperature: number): Promise<ReadableStream<Uint8Array>> {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, temperature }),
  })
  if (!r.ok || !r.body) throw new Error(`chat HTTP ${r.status}`)
  return r.body
}

// ── cronologia immagini (persistente su outputs/history) ──────────────────

export interface HistoryEntry {
  id: string
  model: string
  prompt: string
  size: string
  seed: number
  steps: number
  timeMs: number
  ts: number
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return j(await fetch('/api/history'))
}

export function historyImgUrl(id: string): string {
  return `/api/history/img/${encodeURIComponent(id)}`
}

export async function saveHistory(entry: {
  model: string
  prompt: string
  size: string
  seed: number
  steps: number
  timeMs: number
  dataUrl: string
}): Promise<void> {
  const r = await fetch('/api/history/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d?.error?.message || `HTTP ${r.status}`)
  }
}

export async function clearHistory(): Promise<void> {
  const r = await fetch('/api/history/clear', { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function deleteHistory(id: string): Promise<void> {
  const r = await fetch(`/api/history/delete/${encodeURIComponent(id)}`, { method: 'POST' })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d?.error?.message || `HTTP ${r.status}`)
  }
}