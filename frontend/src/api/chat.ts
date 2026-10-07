import { j, postJson } from './http'

// ── chat locale (llama.cpp llama-server via hub) ──────────────────────────

export interface ChatModelInfo {
  id: string
  name: string
  moe: boolean
  mova?: boolean
}

export interface ChatParams {
  context: number
  kv: string
  mtp: boolean
  cpuMoe: number
  movaCpu: boolean
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

export interface ChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ChatContentPart[]
}

export async function getChatStatus(): Promise<ChatStatus> {
  return j(await fetch('/api/chat/status'))
}

// ── zona Server: telemetria del llama-server ──────────────────────────────

export interface ServerSlot {
  id: number
  nCtx: number
  processing: boolean
  task: number | null
  promptTokens: number
  processed: number
  cached: number
  temperature: number | null
  maxTokens: number | null
  speculative: boolean
}

export interface ServerTiming {
  ms: number
  tokens: number
  tps: number
  slot: number | null
  /** ms/token (solo prefill calcolato, decode dal log) */
  msPerToken?: number
  /** quando è stato visto nel log (epoch ms) */
  at?: number
}

export interface ServerMetrics {
  /** quando è stato costruito il pacchetto (epoch ms) */
  at: number
  /** mtime del text-server.log (epoch ms, 0 se non leggibile) */
  logMtime: number
  running: boolean
  ready: boolean
  /** il server è tracciato da questo hub (false se partito a mano) */
  managed: boolean
  model: string | null
  params: ChatParams | null
  pid: number | null
  port: number
  slots: ServerSlot[]
  busySlot: ServerSlot | null
  prefill: ServerTiming | null
  decode: (ServerTiming & { msPerToken: number }) | null
  live: { done: number; fraction: number; seconds: number; tps: number; etaSec: number; at: number } | null
    /** Generazione in corso: tasso istantaneo sugli ultimi 3 s (tg_3s) e media
     *  della richiesta (tg). tg_3s e' quello che serve a schermo: la media
     *  include i primi token a page cache fredda e risulta piu' bassa. */
    liveDecode: { tokens: number; avgTps: number; tps: number; slot: number | null; at: number } | null
  props: {
    nCtx: number
    nPredict: number | null
    totalSlots: number | null
    modelPath: string | null
    modelAlias: string | null
    ftype: string | null
    buildInfo: string | null
    sleeping: boolean
  } | null
}

export async function getServerMetrics(): Promise<ServerMetrics> {
  return j(await fetch('/api/server/metrics'))
}

export async function startChat(p: ChatParams & { model: string }): Promise<ChatStatus> {
  return postJson('/api/chat/start', p)
}

export async function stopChat(): Promise<ChatStatus> {
  return j(await fetch('/api/chat/stop', { method: 'POST' }))
}

/** Chiamata streaming: restituisce lo stream SSE del hub. `system` opzionale
 *  (es. contesto wiki) viene preposto come messaggio di sistema. `maxTokens`
 *  opzionale limita la lunghezza della risposta (default: contesto intero). */
export async function chatStream(
  messages: ChatMessage[],
  temperature: number,
  system?: string,
  maxTokens?: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const msgs: { role: string; content: string | ChatContentPart[] }[] = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: msgs,
      stream: true,
      temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(`chat HTTP ${r.status}`)
  return r.body
}

/** Narratori cloud: disponibilità (chiave server-side) e voci Gemini.
 *  Il client non vede mai la chiave, solo gli id modello. */
export interface NarratorsStatus {
  gemini: { configured: boolean; models: { id: string; label: string; hint: string }[] }
}

export async function narratorsStatus(): Promise<NarratorsStatus> {
  return j(await fetch('/api/narrators'))
}

/** Stream SSE dal narratore cloud (stesso formato di /api/chat: riusa Text.stream).
 *  `content` accetta testo o parti testo+immagine (Gemini è multimodale). */
export async function narrateStream(
  model: string,
  content: string | ChatContentPart[],
  temperature: number,
  system?: string,
  maxTokens?: number,
): Promise<ReadableStream<Uint8Array>> {
  const r = await fetch('/api/narrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      temperature,
      ...(system ? { system } : {}),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      stream: true,
    }),
  })
  if (!r.ok || !r.body) {
    let msg = `narratore cloud HTTP ${r.status}`
    try {
      const e = await r.json()
      if (e?.error?.message) msg = e.error.message
    } catch { /* corpo non JSON */ }
    throw new Error(msg)
  }
  return r.body
}
