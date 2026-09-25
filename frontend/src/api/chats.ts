// Conversazioni chat persistite dal hub (outputs/chats).
import { j, postJson } from './http'
import type { ChatMessage } from './chat'

export interface ChatMeta {
  id: string
  title: string
  model: string | null
  ts: number
  n: number
}

/** Messaggio salvato su disco: oltre a ruolo/contenuto conserva i frammenti
 *  della knowledge base usati per la risposta (retr) e i numeri di citazione
 *  (cites), così riaprendo una chat le citazioni [n] restano cliccabili. */
export interface SavedMessage extends ChatMessage {
  retr?: unknown
  cites?: number[]
}

export interface ChatDoc {
  id: string
  title: string
  model: string | null
  ts: number
  messages: SavedMessage[]
}

export async function listChats(): Promise<ChatMeta[]> {
  return j(await fetch('/api/chats'))
}

export async function getChat(id: string): Promise<ChatDoc> {
  return j(await fetch(`/api/chats/${encodeURIComponent(id)}`))
}

export async function saveChat(doc: {
  id?: string
  title?: string
  model?: string
  messages: SavedMessage[]
}): Promise<ChatDoc> {
  return postJson('/api/chats', doc)
}

export async function renameChat(id: string, title: string): Promise<void> {
  await postJson(`/api/chats/${encodeURIComponent(id)}/rename`, { title })
}

export async function deleteChat(id: string): Promise<void> {
  await postJson(`/api/chats/${encodeURIComponent(id)}/delete`, {})
}
