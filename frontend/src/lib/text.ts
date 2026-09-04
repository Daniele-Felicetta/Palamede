// Libreria del dominio modelli testuali (chat): un unico namespace `Text`
// con tipi, dati canonici e funzioni pure riutilizzabili in tutto il progetto.
// Qui SOLO logica di dominio: niente fetch (vive in api.ts), niente stato
// (vive in store.svelte.ts / Chat.svelte).
//
// Uso:
//   import { Text } from './lib/text'
//   Text.modelName('ornith-9b')   → 'Ornith 1.5 9B'
//   Text.modelStamp('ornith-35b') → 'Q4_K_M · 20.2 GB'
//   Text.isMoe('ornith-35b')      → true
//   let m: Text.ModelId = 'ornith-9b'

export namespace Text {
  export type ModelId = 'ornith-35b' | 'ornith-9b' | 'ornith-9b-q5'

  /** Dati canonici per-modello. */
  export interface Model {
    id: ModelId
    name: string      // nome breve
    family: string    // famiglia / architettura
    quant: string     // quantizzazione, es. 'Q4_K_M'
    vramGB: string    // peso disco, es. '20.2 GB'
    moe: boolean      // Mixture of Experts
    context: number   // contesto consigliato
    kv: string        // KV cache consigliata
    gpuLayers: number // default layer su GPU
    mtp: boolean      // default multi-token prediction
    cpuMoe: number    // default layer MoE su CPU
    temperature: number
  }

  export const MODELS: Model[] = [
    {
      id: 'ornith-35b',
      name: 'Ornith 1.5 35B-A3B',
      family: 'Ornith-AI · MoE 3B attivi',
      quant: 'Q4_K_M',
      vramGB: '20.2 GB',
      moe: true,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
    },
    {
      id: 'ornith-9b',
      name: 'Ornith 1.5 9B',
      family: 'Ornith-AI',
      quant: 'Q4_K_M',
      vramGB: '5.2 GB',
      moe: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
    },
    {
      id: 'ornith-9b-q5',
      name: 'Ornith 1.5 9B',
      family: 'Ornith-AI',
      quant: 'Q5_K_M',
      vramGB: '6.1 GB',
      moe: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
    },
  ]

  /** Modello selezionato al primo avvio della pagina chat. */
  export const DEFAULT_MODEL: ModelId = 'ornith-9b'

  /** Opzioni KV cache per il pannello impostazioni (valore · etichetta). */
  export const KV_OPTIONS = [
    ['q8_0', 'q8_0 · consigliato'],
    ['q4_0', 'q4_0 · più veloce, qualità ok'],
    ['f16', 'off · massima precisione'],
  ] as const

  export function get(id: string): Model | undefined {
    return MODELS.find((m) => m.id === id)
  }

  /** Nome breve del modello (fallback: l'id stesso). */
  export function modelName(id: string): string {
    return get(id)?.name ?? id
  }

  /** Etichetta verbose es. 'Ornith 1.5 35B-A3B · Q4_K_M' (fallback: l'id). */
  export function modelLabel(id: string): string {
    const m = get(id)
    return m ? `${m.name} · ${m.quant}` : id
  }

  /** true se il modello è Mixture of Experts. */
  export function isMoe(id: string): boolean {
    return get(id)?.moe ?? false
  }

  /** Solo i modelli MoE possono spostare gli esperti su CPU. */
  export function supportsCpuMoe(id: string): boolean {
    return isMoe(id)
  }

  /** Stamp "Q4_K_M · 20.2 GB" per le piastrelle modello (fallback: l'id). */
  export function modelStamp(id: string): string {
    const m = get(id)
    return m ? `${m.quant} · ${m.vramGB}` : id
  }

  /** Default di fabbrica dei parametri di avvio per un modello. */
  export function defaultsFor(id: string): {
    context: number
    kv: string
    mtp: boolean
    cpuMoe: number
    gpuLayers: number
    temperature: number
  } {
    const m = get(id) ?? MODELS[1]
    return {
      context: m.context,
      kv: m.kv,
      mtp: m.mtp,
      cpuMoe: m.cpuMoe,
      gpuLayers: m.gpuLayers,
      temperature: m.temperature,
    }
  }

  /** Riga di stato del server attivo (fallback: stringa vuota se spento). */
  export function statusLine(status: {
    running?: boolean | null
    model?: string | null
    params?: { context?: number; kv?: string; cpuMoe?: number } | null
  } | null): string {
    if (!status?.running) return ''
    const moe = status.params?.cpuMoe ? ` · MoE cpu ${status.params.cpuMoe}` : ''
    return `modello attivo: ${status.model} · ctx ${status.params?.context} · KV ${status.params?.kv}${moe}`
  }

  export interface StreamStats { tps: number; tokens: number }

  /** Parser del flusso SSE de llama.cpp (chat streaming): 'reason' = token di
   *  ragionamento interno, 'content' = testo vero. Su fine chiama onDone
   *  (con stats se presenti nei timings), su errore onErr. */
  export function stream(
    body: ReadableStream<Uint8Array>,
    onDelta: (type: 'reason' | 'content', t: string) => void,
    onDone: (stats?: StreamStats) => void,
    onErr: (e: Error) => void,
  ) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) { onDone(); return }
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { onDone(); return }
          try {
            const j = JSON.parse(data)
            const d = j?.choices?.[0]?.delta
            if (d) {
              if (typeof d.reasoning_content === 'string' && d.reasoning_content) onDelta('reason', d.reasoning_content)
              else if (typeof d.content === 'string' && d.content) onDelta('content', d.content)
              continue
            }
            const t = j?.timings
            if (t && typeof t.predicted_per_second === 'number') {
              onDone({ tps: t.predicted_per_second, tokens: t.predicted_n ?? 0 })
              return
            }
          } catch { /* eventi non JSON ignorati */ }
        }
        pump()
      }).catch((e) => onErr(e instanceof Error ? e : new Error(String(e))))
    }
    pump()
  }
}
