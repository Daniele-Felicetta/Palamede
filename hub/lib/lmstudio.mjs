// Palamede hub — proxy LM Studio (OpenAI-compatible, di default :1234).
// Pass-through generico di metodo/body/query: copre sia le risposte JSON
// (/v1/models) sia lo stream SSE (/v1/chat/completions). Serve i modelli
// vision-language per il gioco.

import { LMSTUDIO } from './root.mjs'
import { proxyStream } from './proxy.mjs'

export function proxyLmStudio(req, res, path) {
  const u = new URL(req.url, 'http://localhost')
  const rest = path.replace(/^\/api\/lmstudio/, '') || '/'
  const target = new URL(LMSTUDIO)
  return proxyStream(req, res, {
    host: target.hostname, port: target.port, path: rest + u.search,
    accept: 'text/event-stream, application/json', defaultType: 'application/json',
    errorMessage: 'LM Studio non raggiungibile — avvialo e carica il modello vision-language',
  })
}
