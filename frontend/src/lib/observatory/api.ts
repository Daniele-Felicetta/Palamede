// Palamede — Osservatorio: client del backend.
//
// Due canali, come da `backend/server.py`:
//   - i COMANDI viaggiano su POST (`/api/train`, `/api/config`, ...)
//   - gli EVENTI scendono su `GET /api/stream` (`text/event-stream`)
//
// Il canale eventi e' SSE e non WebSocket perche' uvicorn, nel venv che gira
// l'osservatorio, non ha un'implementazione WebSocket e non se ne puo'
// installare una (certificato TLS intercettato in rete). La nota completa,
// con il warning esatto di uvicorn, sta nel docstring di `backend/server.py`.
//
// `EventSource` e' nativo del browser: nessuna libreria, e il browser
// rimanda da solo `Last-Event-ID` quando la connessione cade, cosi' il server
// puo' recapitare gli eventi persi.

import type {
  CompareResult,
  HelloPayload,
  ObsConfig,
  UpdateEnd,
} from './types'

/** Il backend gira su :8131; il hub lo inoltra su /api/observatory. */
const BASE = '/api/observatory'

export class ObservatoryError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ObservatoryError'
  }
}

async function call<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new ObservatoryError(
      `backend non raggiungibile su :8131 — avvialo con scripts/start-observatory.ps1`,
    )
  }
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new ObservatoryError(msg, res.status, data)
  }
  return data as T
}

export const getConfig = () => call<ObsConfig>('/api/config', undefined, 'GET')
export const loadModel = () => call<{ ok: boolean; model: unknown }>('/api/load')
export const unloadModel = () => call<{ ok: boolean }>('/api/unload')
export const resetModel = () => call<{ ok: boolean; model: unknown }>('/api/reset-model')
export const saveConfig = (patch: Partial<ObsConfig>) =>
  call<{ ok: boolean; config: ObsConfig }>('/api/config', patch)
export const train = (prompt: string, target: string, steps?: number) =>
  call<{ ok: boolean; update: UpdateEnd }>('/api/train', { prompt, target, steps })
export const generate = (prompt: string, maxNewTokens?: number) =>
  call<{ text: string; tokens: string[]; tokens_per_second: number; seconds: number }>(
    '/api/generate',
    { prompt, max_new_tokens: maxNewTokens },
  )
export const compare = (a: number, b: number) =>
  call<CompareResult & { ok: boolean }>('/api/compare', { a, b })
export const clearHistory = () => call<{ ok: boolean }>('/api/clear-history')
export const stepAdvance = () => call<{ ok: boolean }>('/api/step-advance')

/** Nomi degli eventi che il backend puo' emettere. */
export type EventKind =
  | 'hello'
  | 'status'
  | 'model_state'
  | 'graph'
  | 'history'
  | 'update_start'
  | 'step'
  | 'paused'
  | 'update_end'
  | 'error'

export type EventHandler = (kind: EventKind, data: Record<string, unknown>) => void

export interface Stream {
  close: () => void
}

/**
 * Si collega allo stream eventi e smista per tipo.
 *
 * `EventSource` si riconnette da solo, ma solo se lo stream chiude pulito: per
 * questo il backend manda un commento `: keepalive` ogni 15 s quando la coda
 * e' vuota, e i proxy non devono accumulare (header `X-Accel-Buffering: no`).
 */
export function connect(onEvent: EventHandler, onStatus: (up: boolean, note: string) => void): Stream {
  let es: EventSource | null = null
  let closed = false

  const open = () => {
    if (closed) return
    es = new EventSource(`${BASE}/api/stream`)

    es.onopen = () => onStatus(true, 'stream eventi aperto')
    es.onerror = () => {
      if (closed) return
      onStatus(false, 'stream interrotto, riconnessione…')
    }

    const kinds: EventKind[] = [
      'hello', 'status', 'model_state', 'graph', 'history',
      'update_start', 'step', 'paused', 'update_end', 'error',
    ]
    for (const kind of kinds) {
      es.addEventListener(kind, (ev) => {
        onStatus(true, '')
        const msg = ev as MessageEvent<string>
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(msg.data)
        } catch {
          data = { error: 'payload non JSON', raw: msg.data }
        }
        onEvent(kind, data)
      })
    }
  }

  open()
  return {
    close() {
      closed = true
      es?.close()
    },
  }
}

/** Il primo `hello` che il backend manda all'apertura dello stream. */
export type HelloEvent = HelloPayload
