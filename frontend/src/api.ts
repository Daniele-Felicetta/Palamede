import { Images } from './lib/images'
import { Text } from './lib/text'

// Client verso il hub (:4600). Il hub serializza le generazioni su GPU,
// quindi una chiamata = un posto in coda.

export interface GenRequest {
  model: Images.ModelId
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

/** Generazione rapida con default di fabbrica: bonsai · 512² · step consigliati
 *  (4) · seed -1 · 1 copia. Sovrascrivibile con `opts`
 *  (es. { model: "zimage", width: 1024, height: 1024 }). */
export async function generateQuick(
  prompt: string,
  opts: Partial<Omit<GenRequest, "prompt">> = {},
): Promise<GenImage[]> {
  return generateImage({
    model: "bonsai",
    prompt,
    steps: Images.DEFAULT_STEPS.bonsai,
    seed: -1,
    width: 1024,
    height: 1024,
    count: 1,
    ...opts,
  })
}

/** Generazione testuale rapida (storia/risposta) con default di fabbrica:
 *  modello consigliato (ornith-9b), temperatura 0.7. Avvia il server solo se
 *  non è già attivo con quel modello, streamma la risposta e la restituisce
 *  completa. `onDelta` (opzionale) riceve i token di contenuto in tempo reale. */
export async function generateQuickText(
  prompt: string,
  opts: { model?: string; temperature?: number; onDelta?: (t: string) => void } = {},
): Promise<string> {
  const model = opts.model ?? Text.DEFAULT_MODEL
  const temperature = opts.temperature ?? 0.7
  const st = await getChatStatus().catch(() => null)
  if (!st?.running || !st.ready || st.model !== model) {
    await startChat({ model, ...Text.defaultsFor(model) })
  }
  const stream = await chatStream([{ role: 'user', content: prompt }], temperature)
  return new Promise((resolve, reject) => {
    let out = ''
    Text.stream(
      stream,
      (type, t) => { if (type === 'content') { out += t; opts.onDelta?.(t) } },
      () => resolve(out),
      (e) => reject(e),
    )
  })
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
  thinking: boolean
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

/** Chiamata streaming: restituisce lo stream SSE del hub. `system` opzionale
 *  (es. contesto wiki) viene preposto come messaggio di sistema. */
export async function chatStream(
  messages: ChatMessage[],
  temperature: number,
  system?: string,
): Promise<ReadableStream<Uint8Array>> {
  const msgs: { role: string; content: string }[] = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: msgs, stream: true, temperature }),
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
  return j(await fetch('/api/history', { cache: 'no-store' }))
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

// ── knowledge base (llm-wiki: raw/ → wiki/ compilata dal modello) ────────

// ── TRELLIS.2 image-to-3D (via hub :4600 → venv trellis :8124) ─────────────

export interface TrellisStatus {
  running: boolean // subprocess del hub vivo (server :8124 raggiungibile)
  ready: boolean // pipeline caricata in VRAM (true dopo il primo carico)
  loading: boolean // true mentre carica per la prima volta (mantenuto per compatibilità)
  pid: number | null
  load_time_s: number | null // secondi di caricamento della pipeline (se già avviata)
}

export interface Generate3DResult {
  glb_base64: string // data:model/gltf-binary;base64,...
  path: string
  url: string // /api/3d/file/<id>.glb
  stl_url: string // /api/3d/file/<id>.stl (solo geometria)
  vertices: number
  faces: number
  time_s: number
  vram_peak_gb: number
  seed: number
  pipeline_type: string
}

export interface Generate3DRequest {
  image: string // dataUrl dell'immagine di partenza
  pipeline_type?: string // '512' (default) | '1024'
  seed?: number // -1 = casuale
  num_samples?: number // 1–4
}

export async function get3DStatus(): Promise<TrellisStatus> {
  return j(await fetch('/api/3d/status'))
}

export async function start3D(): Promise<TrellisStatus> {
  const r = await fetch('/api/3d/start', { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || `HTTP ${r.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as TrellisStatus
}

export async function stop3D(): Promise<TrellisStatus> {
  const r = await fetch('/api/3d/stop', { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || `HTTP ${r.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as TrellisStatus
}

export async function generate3D(req: Generate3DRequest): Promise<Generate3DResult> {
  const r = await fetch('/api/3d/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: req.image,
      pipeline_type: req.pipeline_type ?? '512',
      seed: req.seed ?? -1,
      num_samples: req.num_samples ?? 1,
    }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || data?.detail || `HTTP ${r.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as Generate3DResult
}

export interface KbFileInfo { name: string; bytes: number; mtime: number }
export interface KbStatus {
  ok: boolean
  raw: number
  wiki: number
  index: string
  log: string
  schema: string
  chat: ChatStatus
}
export interface KbFiles { area: string; files: KbFileInfo[] }
export interface KbRead { path: string; content: string }
export interface KbEmbeddings { available: boolean; models: string[] }
export interface KbIngestResult { ok: boolean; written: string[] }
export interface KbSearchResult { query: string; pages: string[] }

export async function getKbStatus(): Promise<KbStatus> {
  return j(await fetch('/api/kb/status', { cache: 'no-store' }))
}

export async function getKbFiles(area: 'raw' | 'wiki'): Promise<KbFiles> {
  return j(await fetch(`/api/kb/files?area=${area}`, { cache: 'no-store' }))
}

export async function readKbFile(path: string): Promise<KbRead> {
  return j(await fetch(`/api/kb/read?path=${encodeURIComponent(path)}`, { cache: 'no-store' }))
}

export async function saveKbFile(path: string, content: string): Promise<void> {
  const r = await fetch('/api/kb/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
}

export async function deleteKbFile(path: string): Promise<boolean> {
  const r = await fetch('/api/kb/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
  return !!d.ok
}

export async function ingestKbSource(source: string): Promise<KbIngestResult> {
  const r = await fetch('/api/kb/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
  return d
}

export async function searchKb(query: string): Promise<KbSearchResult> {
  return j(await fetch(`/api/kb/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' }))
}

export async function getKbEmbeddings(): Promise<KbEmbeddings> {
  return j(await fetch('/api/kb/embeddings', { cache: 'no-store' }))
}

export interface DocResult { name: string; text: string }

// Documentazione del progetto (MAPPA/README/SPEC/SECURITY servite dal hub).
export async function getDoc(name: 'mappa' | 'readme' | 'spec' | 'security'): Promise<DocResult> {
  const r = await fetch(`/api/doc?name=${name}`)
  if (!r.ok) throw new Error(`documento ${name}: HTTP ${r.status}`)
  return r.json()
}