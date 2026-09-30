// Tipo e helper di vista condivisi tra Chat.svelte e MessageList.svelte:
// un messaggio a schermo (stato di stream incluso) e la sua resa testuale.
import type { ChatMessage, KbRetrieveResult } from '../api'

export interface ViewMsg extends ChatMessage {
  pending?: boolean
  reason?: string
  retr?: KbRetrieveResult | null
  cites?: number[]
}

// Testo leggibile di un messaggio: i contenuti multimodali (array di parti)
// si riducono alle sole parti testuali.
export const msgText = (m: ViewMsg): string =>
  typeof m.content === 'string'
    ? m.content
    : m.content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')
