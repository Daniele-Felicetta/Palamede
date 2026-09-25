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
  export type ModelId = 'ornith-35b' | 'ornith-9b' | 'ornith-9b-q5' | 'k2-7b' | 'k2-36b' | 'bonsai-27b' | 'lfm-vl-3b' | 'gemma-4-26b' | 'minicpm5-2b'

  /** Dati canonici per-modello. */
  export interface Model {
    id: ModelId
    name: string      // nome breve
    family: string    // famiglia / architettura
    quant: string     // quantizzazione, es. 'Q4_K_M'
    vramGB: string    // peso disco, es. '20.2 GB'
    moe: boolean      // Mixture of Experts
    mova: boolean     // Mixture-of-Value attention (K2 Horizon)
    context: number   // contesto consigliato
    kv: string        // KV cache consigliata
    gpuLayers: number // default layer su GPU
    mtp: boolean      // default multi-token prediction
    cpuMoe: number    // default layer MoE su CPU
    movaCpu: boolean  // default: banco MoVA dell'attenzione su CPU
    temperature: number
    thinking: boolean // ragionamento interno (thinking) del modello
  }

  export const MODELS: Model[] = [
    {
      id: 'ornith-35b',
      name: 'Ornith 1.5 35B-A3B',
      family: 'Ornith-AI · MoE 3B attivi',
      quant: 'Q4_K_M',
      vramGB: '20.2 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: false,
    },
    {
      id: 'ornith-9b',
      name: 'Ornith 1.5 9B',
      family: 'Ornith-AI',
      quant: 'Q4_K_M',
      vramGB: '5.2 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: false,
    },
    {
      id: 'ornith-9b-q5',
      name: 'Ornith 1.5 9B',
      family: 'Ornith-AI',
      quant: 'Q5_K_M',
      vramGB: '6.1 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: false,
    },
    {
      id: 'k2-7b',
      name: 'K2 Horizon 7B',
      family: 'IFM · dense · reasoning',
      quant: 'Q4_K_M',
      vramGB: '5.2 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: true,
    },
    {
      id: 'k2-36b',
      name: 'K2 Horizon 36B-A4B',
      family: 'IFM · MoVA · MoE 4B attivi',
      quant: 'Q4_K_M',
      vramGB: '20.8 GB',
      moe: true,
      mova: true,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 45,
      movaCpu: false,
      temperature: 0.7,
      thinking: true,
    },
    {
      id: 'bonsai-27b',
      name: 'Bonsai 27B',
      family: 'Bonsai',
      quant: 'Q1_0',
      vramGB: '3.5 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: false,
    },
    {
      id: 'lfm-vl-3b',
      name: 'LFM2.5 VL 3B',
      family: 'Liquid AI · vision-language',
      quant: 'Q5_K_XL',
      vramGB: '1.8 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 16384,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: false,
    },
    {
      id: 'gemma-4-26b',
      name: 'Gemma 4 26B-A4B',
      family: 'Google · MoE 3.8B attivi',
      quant: 'IQ3_S',
      vramGB: '10.5 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      context: 4096,
      kv: 'q4_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: -1,
      temperature: 0.6,
      thinking: false,
    },
    {
      id: 'minicpm5-2b',
      name: 'MiniCPM5 2B',
      family: 'OpenBMB · dense',
      quant: 'Q4_K_M',
      vramGB: '1.5 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 8192,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.7,
      thinking: false,
    },
  ]

  /** Modello selezionato al primo avvio della pagina chat. */
  export const DEFAULT_MODEL: ModelId = 'ornith-9b'

  /** Opzioni KV cache per il pannello impostazioni (valore · etichetta). */
  export const KV_OPTIONS = [
    ['q8_0', 'q8_0 · consigliato'],
    ['q4_0', 'q4_0 · più veloce, qualità ok'],
    ['f16', 'f16 · nessuna quantizzazione'],
  ] as const

  /** Profili VRAM preselezionati per i modelli MoVA (K2 36B): impastano
   *  cpuMoe + movaCpu in una scelta comprensibile. Misure reali su RTX 5060 Ti
   *  16 GB (llama-bench, generazione). */
  export interface VramProfile {
    id: string
    label: string
    hint: string
    cpuMoe: number
    movaCpu: boolean
  }

  export const K2_36B_PROFILES: VramProfile[] = [
    { id: 'coexist', label: 'Coesistenza (Immagini + chat)', hint: '~3,6 GB · 22 t/s', cpuMoe: 45, movaCpu: true },
    { id: 'coexist-fast', label: 'Coesistenza veloce', hint: '~6,8 GB · 28 t/s', cpuMoe: 45, movaCpu: false },
    { id: 'max-speed', label: 'Velocità max (GPU al chat)', hint: '~13 GB · 40 t/s', cpuMoe: 25, movaCpu: false },
  ]

  /** Profili VRAM disponibili per un modello (solo MoVA per ora). */
  export function vramProfilesFor(id: string): VramProfile[] {
    return supportsMova(id) ? K2_36B_PROFILES : []
  }

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

  /** Solo i modelli MoVA (K2 Horizon) hanno il banco dell'attenzione su CPU. */
  export function supportsMova(id: string): boolean {
    return get(id)?.mova ?? false
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
    movaCpu: boolean
    gpuLayers: number
    temperature: number
    thinking: boolean
  } {
    const m = get(id) ?? MODELS[1]
    return {
      context: m.context,
      kv: m.kv,
      mtp: m.mtp,
      cpuMoe: m.cpuMoe,
      movaCpu: m.movaCpu,
      gpuLayers: m.gpuLayers,
      temperature: m.temperature,
      thinking: m.thinking,
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
   *  ragionamento interno, 'content' = testo vero. Su fine chiama onDone UNA
   *  sola volta (con stats se presenti nei timings), su errore onErr. */
  export function stream(
    body: ReadableStream<Uint8Array>,
    onDelta: (type: 'reason' | 'content', t: string) => void,
    onDone: (stats?: StreamStats) => void,
    onErr: (e: Error) => void,
  ) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let finished = false
    // Il server può mandare sia i timings che [DONE]: senza guardia onDone
    // scatterebbe due volte (resolve idempotente, ma i chiamanti contano una
    // sola chiusura). Il reader si chiude da sé a risposta esaurita.
    const done = (stats?: StreamStats) => {
      if (finished) return
      finished = true
      onDone(stats)
    }
    const pump = (): void => {
      reader.read().then(({ done: doneFlag, value }) => {
        if (doneFlag) { done(); return }
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { done(); return }
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
              done({ tps: t.predicted_per_second, tokens: t.predicted_n ?? 0 })
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
