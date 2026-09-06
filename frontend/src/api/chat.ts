import { Text } from '../lib/text'
import { j, postJson } from './http'

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
  })
  if (!r.ok || !r.body) throw new Error(`chat HTTP ${r.status}`)
  return r.body
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
