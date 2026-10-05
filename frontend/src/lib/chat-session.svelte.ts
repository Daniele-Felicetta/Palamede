// Sessione di chat viva: lo stato della conversazione in corso vive a livello
// di modulo, non nel componente Chat.svelte. La pagina Chat si smonta a ogni
// cambio rotta (App.svelte sostituisce <Page />), ma con lo stato qui:
//   - lo stream in corso continua in background (il pump di Text.stream scrive
//     in session.messages, che non viene distrutto);
//   - al ritorno la generazione e' ancora visibile, con statistiche, bozza del
//     composer e conversazione intatti;
//   - la cronologia a schermo sopravvive anche se la risposta finisce mentre
//     sei su un'altra pagina (finish + persist girano comunque).
import { Text } from './text'
import type { ViewMsg as Msg } from './chat-view'
import type { ChatMeta } from '../api'

export interface ChatStats {
  tps: number
  tokens: number | null
  live: boolean
}

export const session = $state({
  model: Text.DEFAULT_MODEL as Text.ModelId,
  settings: Text.defaultsFor(Text.DEFAULT_MODEL),
  kbOn: false,
  messages: [] as Msg[],
  input: '',
  sending: false,
  stats: null as ChatStats | null,
  genAbort: null as AbortController | null,
  genStart: 0,
  chars: 0,
  chatId: null as string | null,
  chatList: [] as ChatMeta[],
  busy: false,
  err: '',
})
