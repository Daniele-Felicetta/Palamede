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
  export type ModelId = 'ornith-35b' | 'ornith-9b' | 'ornith-9b-q5' | 'k2-7b' | 'k2-36b' | 'bonsai-27b' | 'lfm-vl-3b' | 'gemma-4-26b' | 'gemma-4-12b' | 'minicpm5-2b' | 'pocket-darwin-180b'

  /** Dati canonici per-modello. */
  export interface Model {
    id: ModelId
    name: string      // nome breve
    family: string    // famiglia / architettura
    quant: string     // quantizzazione, es. 'Q4_K_M'
    diskGB: string    // peso disco, es. '20.2 GB'
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
      diskGB: '20.2 GB',
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
      name: 'Ornith 1.5 9B (Q4)',
      family: 'Ornith-AI',
      quant: 'Q4_K_M',
      diskGB: '5.2 GB',
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
      name: 'Ornith 1.5 9B (Q5)',
      family: 'Ornith-AI',
      quant: 'Q5_K_M',
      diskGB: '6.1 GB',
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
      diskGB: '5.2 GB',
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
      diskGB: '20.8 GB',
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
      diskGB: '3.5 GB',
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
      diskGB: '1.8 GB',
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
      diskGB: '10.5 GB',
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
      id: 'gemma-4-12b',
      name: 'Gemma 4 12B IT (Jarvis)',
      family: 'Google · dense · italiano',
      quant: 'QAT UD-Q4_K_XL',
      diskGB: '6.7 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 16384,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.6,
      thinking: false,
    },
    {
      id: 'minicpm5-2b',
      name: 'MiniCPM5 2B',
      family: 'OpenBMB · dense',
      quant: 'Q4_K_M',
      diskGB: '1.5 GB',
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
      id: 'pocket-darwin-180b',
      name: 'POCKET-Darwin 180B',
      family: 'FINAL-Bench · MoE 512 esperti, 3B attivi · reasoning',
      quant: 'UD-Q4_K_XL',
      diskGB: '103.7 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      // 48 layer: cpuMoe 44 tiene i primi 44 layer di esperti su RAM/NVMe e
      // carica gli ultimi 4 in VRAM. Misure su RTX 5060 Ti 16 GB + 64 GB RAM
      // (i7-14700K, 20 thread): 14,5 GB VRAM e 13,5 tok/s, contro 7,6 GB e
      // 9,3 tok/s con cpuMoe -1 (tutti gli esperti su RAM). Il modello sta
      // 111 GB su disco: sotto i ~64 GB di RAM gli esperti NON ci stanno e
      // llama.cpp li rilegge dall'SSD a ogni token.
      // 65536 e' il massimo REALE su 64 GB di RAM (il modello dichiara 131072,
      // ma la KV e' per 4 slot: 24 GB in f16 a 65536 contro 48 GB a 131072).
      // Oltre, la KV schiaccia la page cache del modello e il prefill crolla da
      // 60,6 a 26,9 t/s (2,3x piu lento) con la generazione a -40%.
      // chat.mjs blocca il contesto sopra questa soglia (maxContext).
      context: 131072,
      // KV q8_0, non f16 e non q4_0. Motivi, tutti misurati su questo modello:
      //
      // - La KV non e' il collo di bottiglia: il traffico per forward pass e'
      //   dominato dai ~100 GB di pesi letti dall'SSD (512 esperti, 10 attivi
      //   per token). La KV e' 96 KiB/token in f16, 48 in q8_0, 24 in q4_0.
      // - f16 e q8_0 danno lo STESSO score (96,7%, 29/30) e le stesse
      //   velocita'. Potendo scegliereSpende gli stessi ~6 GB di KV, q8_0
      //   raddoppia il contesto utile: e' ildominante.
      // - Il budget e' ~6 GB di KV: f16 regge fino a 65536 (12,6 GB a 131072
      //   -> prefill 164s), q8_0 regge fino a 131072 (12,6 GB a 262144 ->
      //   prefill 147s).
      // - q4_0 NON aiuta: pur restando sotto budget a 262144 (6,0 GB) il
      //   prefill peggiora a 102s contro i 65s di q8_0@131072. Il costo che
      //   scala col contesto non sono i byte della KV ma l'accesso a un
      //   buffer grande usato a spruzzo.
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 44,
      // Il model card raccomanda temperature 1.0 (top-p 0.95, top-k 20: la
      // UI non espone gli ultimi due).
      temperature: 1.0,
      thinking: true,
    },
  ]

  /** Modello selezionato al primo avvio della pagina chat. */
  export const DEFAULT_MODEL: ModelId = 'ornith-9b'

  /** Opzioni KV cache per il pannello impostazioni. `bytes` = byte per
   *  elemento della KV (q4_0 mezzo byte), da cui il peso relativo a f16. */
  export interface KvOption {
    id: string
    bytes: number
    hint: string
  }

  export const KV_OPTIONS: KvOption[] = [
    { id: 'q8_0', bytes: 1, hint: 'consigliata: metà memoria di f16, qualità quasi identica' },
    { id: 'q4_0', bytes: 0.5, hint: 'massima velocità, un filo di qualità in meno' },
    { id: 'f16', bytes: 2, hint: 'nessuna quantizzazione: il banchetto più grosso' },
  ]

  /** Peso in memoria di un tipo di KV rispetto a f16 (2 byte per elemento). */
  export function kvRel(bytes: number): string {
    return `${(bytes / 2).toLocaleString('it-IT')}×`
  }

  /** Profili VRAM preselezionati: impastano in una scelta comprensibile i
   *  parametri che competono per la stessa risorsa. `kv` e `context` sono
   *  opzionali (i profili MoVA non li toccano). Misure reali su RTX 5060 Ti
   *  16 GB + 64 GB RAM (i7-14700K, 20 thread), prompt da 3662 token. */
  export interface VramProfile {
    id: string
    label: string
    hint: string
    cpuMoe: number
    movaCpu: boolean
    kv?: string
    context?: number
  }

  export const K2_36B_PROFILES: VramProfile[] = [
    { id: 'coexist', label: 'Coesistenza (Immagini + chat)', hint: '~3,6 GB · 22 t/s', cpuMoe: 45, movaCpu: true },
    { id: 'coexist-fast', label: 'Coesistenza veloce', hint: '~6,8 GB · 28 t/s', cpuMoe: 45, movaCpu: false },
    { id: 'max-speed', label: 'Velocità max (GPU al chat)', hint: '~13 GB · 40 t/s', cpuMoe: 25, movaCpu: false },
  ]

  /** POCKET-Darwin 180B: 111 GB in 4 shard, gli esperti vivono su NVMe e la
   *  VRAM libera dipende solo da cpuMoe (il contesto non la tocca). I tre
   *  profili hanno tutti ~6 GB di KV tranne il gaming, che ne usa 0,9.
   *  Il gaming e' piu' VELOCE del base, non piu' lento: con tutti gli esperti
   *  su CPU il flusso di lettura da NVMe resta sequenziale e il prefill
   *  scende da 64,8 s a 48,3 s. */
  export const DARWIN_PROFILES: VramProfile[] = [
    {
      id: 'balanced',
      label: 'Bilanciato',
      hint: '131k contesto · ~15 GB VRAM · 13,7 t/s',
      cpuMoe: 44, movaCpu: false, kv: 'q8_0', context: 131072,
    },
    {
      id: 'long-ctx',
      label: 'Contesto lungo',
      hint: '262k contesto · prefill 102 s · 12,0 t/s',
      cpuMoe: 44, movaCpu: false, kv: 'q4_0', context: 262144,
    },
    {
      id: 'gaming',
      label: 'Gaming (libera VRAM per i modelli immagine)',
      hint: '80k contesto · ~7 GB VRAM · 13,6 t/s',
      cpuMoe: -1, movaCpu: false, kv: 'q8_0', context: 81920,
    },
    {
      id: 'gaming-long',
      label: 'Gaming + contesto lungo',
      hint: '262k contesto · ~7 GB VRAM · KV q4_0',
      cpuMoe: -1, movaCpu: false, kv: 'q4_0', context: 262144,
    },
    {
      id: 'gaming-131k',
      label: 'Gaming 131k',
      hint: '131k contesto · ~7 GB VRAM · KV q4_0',
      cpuMoe: -1, movaCpu: false, kv: 'q4_0', context: 131072,
    },
  ]

  /** Profili VRAM disponibili per un modello. */
  export function vramProfilesFor(id: string): VramProfile[] {
    if (supportsMova(id)) return K2_36B_PROFILES
    if (id === 'pocket-darwin-180b') return DARWIN_PROFILES
    return []
  }

  /** Il profilo che corrisponde ai parametri correnti, o undefined. Serve alla
   *  select per mostrare 'personalizzato' quando l'utente tocca un campo. */
  export function activeProfile(id: string, cur: { cpuMoe: number; movaCpu: boolean; kv?: string; context?: number }): VramProfile | undefined {
    return vramProfilesFor(id).find((p) =>
      p.cpuMoe === cur.cpuMoe && p.movaCpu === cur.movaCpu &&
      (p.kv === undefined || p.kv === cur.kv) &&
      (p.context === undefined || p.context === cur.context))
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
    return m ? `${m.quant} · ${m.diskGB}` : id
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
