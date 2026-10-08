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
  export type ModelId = 'ornith-35b' | 'ornith-9b' | 'ornith-9b-q5' | 'k2-7b' | 'k2-36b' | 'bonsai-27b' | 'lfm-vl-3b' | 'gemma-4-26b' | 'gemma-4-12b' | 'minicpm5-2b' | 'qwen38-27b' | 'pocket-darwin-180b'

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
      id: 'qwen38-27b',
      name: 'Qwen3.8 27B',
      family: 'Qwen · dense ibrido · reasoning',
      quant: 'IQ3_XXS (GSQ-RCO)',
      diskGB: '10.1 GB',
      moe: false,
      mova: false,
      movaCpu: false,
      context: 32768,
      kv: 'q4_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 0,
      temperature: 0.6,
      thinking: true,
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
      // DEFAULT: MTP ON e cpuMoe -1. Misure su RTX 5060 Ti 16 GB + 64 GB RAM
      // (i7-14700K, 20 thread, llama.cpp b11457), mediana di 3 generazioni:
      //   cpuMoe 44,  senza MTP .... 21,4 t/s   (~14,5 GB VRAM)
      //   cpuMoe -1,  senza MTP .... 19,5 t/s   (~7,6 GB VRAM)   <- -8,8%
      //   cpuMoe -1,  con MTP ..... 26,5 t/s   (~10 GB VRAM)    <- +33%
      // Quindi liberare VRAM da solo e' un DANNO: il guadagno e' interamente
      // dell'MTP, e solo se l'head del draft (2,6 GB) ci entra. Con cpuMoe 44
      // la VRAM e' piena, il draft non ci sta, il suo forward attraversa il
      // PCIe a ogni token e il draft costa piu' di quanto faccia risparmiare
      // (misurato -5%).
      // I valori che stavano qui prima ("13,5 t/s con cpuMoe 44 contro 9,3 con
      // cpuMoe -1") non si riproducono: ogni variazione tranne il contesto e'
      // dentro il rumore (deviazione standard ~10 t/s sul prefill).
      context: 32768,
      // KV q8_0: senza MTP la scelta dei bit e' dentro il rumore (misurato a
      // 32768 con llama-bench: q8_0 18,1 t/s contro q4_0 17,8). CON MTP invece
      // costa ~30%: a ogni forward la verifica del draft rilegge la KV, e la
      // dequantizzazione a 4 bit si paga su ogni token invece che una volta
      // sola. Misurato end-to-end col profilo veloce: 32k+q8_0 22-25 t/s
      // contro 32k+q4_0 15-20 t/s. Con MTP la KV si paga in velocita', non
      // solo in byte.
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: true,
      cpuMoe: -1,
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
    /** Spec-decode MTP: richiede cpuMoe -1, perche' l'head del draft (2,6 GB)
     *  deve stare in VRAM insieme al modello o il suo forward attraversa il
     *  PCIe a ogni token e il draft costa piu' di quanto risparmi. */
    mtp?: boolean
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
      hint: '131k contesto · ~15 GB VRAM · 20 t/s',
      cpuMoe: 44, movaCpu: false, kv: 'q8_0', context: 131072,
    },
    {
      id: 'lean',
      label: 'Leggero (meno RAM, stessa qualità)',
      hint: '131k contesto · ~15 GB VRAM · 3 GB di KV in meno',
      cpuMoe: 44, movaCpu: false, kv: 'q4_0', context: 131072,
    },
    {
      id: 'long-ctx',
      label: 'Contesto lungo',
      hint: '262k contesto · prefill lungo · 18 t/s',
      cpuMoe: 44, movaCpu: false, kv: 'q4_0', context: 262144,
    },
    // I profili 'veloce*' mettono mtp: true e KV q8_0. La KV conta con l'MTP
    // (senza era dentro il rumore): la verifica del draft rilegge la KV a ogni
    // forward, quindi q4_0 si paga per token invece che una volta sola.
    //
    // Le cifre qui sotto sono le MISURE SUSTENUTE con risposte da 400 token
    // (max_tokens 250 che generavano 70 token avevano dato 26-27 t/s: era un
    // artefatto di risposte corte, non un regime). Il primo messaggio dopo
    // l'avvio e' sempre piu' lento (7-12 t/s): i 104 GB di pesi devono entrare
    // in page cache e su 64 GB di RAM non ci stanno.
    //
    //   32k + q8_0 ..... 22-25 t/s   <- scelta consigliata
    //   131k + q8_0 .... 15-17 t/s
    //   131k + q4_0 .... 13-15 t/s   <- il vecchio gaming-131k: il peggiore
    //
    // Il contesto costa perche' la KV grande ruba la page cache al modello:
    // e' la finestra che allochi che ti toglie la cache che ti rende veloce.
    {
      id: 'gaming',
      label: 'Veloce (MTP, 32k contesto)',
      hint: '32k contesto · ~10 GB VRAM · 22-25 t/s',
      cpuMoe: -1, movaCpu: false, kv: 'q8_0', context: 32768, mtp: true,
    },
    {
      id: 'gaming-60k',
      label: 'Veloce 60k',
      hint: '60k contesto · ~10 GB VRAM · ~20 t/s',
      cpuMoe: -1, movaCpu: false, kv: 'q8_0', context: 61440, mtp: true,
    },
    {
      id: 'gaming-80k',
      label: 'Veloce 80k',
      hint: '80k contesto · ~10 GB VRAM · ~19 t/s',
      cpuMoe: -1, movaCpu: false, kv: 'q8_0', context: 81920, mtp: true,
    },
    {
      id: 'gaming-131k',
      label: 'Veloce 131k',
      hint: '131k contesto · ~10 GB VRAM · 15-17 t/s',
      cpuMoe: -1, movaCpu: false, kv: 'q8_0', context: 131072, mtp: true,
    },
    {
      id: 'gaming-long',
      label: 'Veloce + contesto lungo',
      hint: '262k contesto · ~10 GB VRAM · ~13 t/s',
      cpuMoe: -1, movaCpu: false, kv: 'q8_0', context: 262144, mtp: true,
    },
  ]

  /** Qwen3.8 27B: dense 27B, niente MoE/MoVA (cpuMoe/movaCpu sempre 0/false).
   *  Misure su RTX 5060 Ti 16 GB (llama.cpp b11457, offload pieno):
   *  32k+q4_0 12,98 GB · prompt 174 t/s · gen ~32 t/s; 32k+f16 14,34 GB
   *  (KV max non paga: stessa recall, -15% velocita'); 131k+q4_0 15,18 GB ·
   *  gen ~32 t/s, ago da 36k token ritrovato a ~700 t/s di prefill. Il 60k+q8_0
   *  e' stimato per interpolazione (~14,2 GB). 262k si carica ma va in
   *  spilling (16 GB pieni, ~3-5 t/s): fuori dai profili. */
  export const QWEN38_PROFILES: VramProfile[] = [
    {
      id: 'standard',
      label: 'Standard (32k, KV q4)',
      hint: '32k contesto · ~13 GB VRAM · ~32 t/s',
      cpuMoe: 0, movaCpu: false, kv: 'q4_0', context: 32768,
    },
    {
      id: 'balanced-60k',
      label: 'Bilanciato (60k, KV q8)',
      hint: '60k contesto · ~14 GB VRAM · ~28 t/s',
      cpuMoe: 0, movaCpu: false, kv: 'q8_0', context: 61440,
    },
    {
      id: 'long-131k',
      label: 'Contesto lungo (131k, KV q4)',
      hint: '131k contesto · ~15,2 GB VRAM · ~30 t/s',
      cpuMoe: 0, movaCpu: false, kv: 'q4_0', context: 131072,
    },
  ]

  /** Profili VRAM disponibili per un modello. */
  export function vramProfilesFor(id: string): VramProfile[] {
    if (supportsMova(id)) return K2_36B_PROFILES
    if (id === 'pocket-darwin-180b') return DARWIN_PROFILES
    if (id === 'qwen38-27b') return QWEN38_PROFILES
    return []
  }

  /** Il profilo che corrisponde ai parametri correnti, o undefined. Serve alla
   *  select per mostrare 'personalizzato' quando l'utente tocca un campo. */
export function activeProfile(id: string, cur: { cpuMoe: number; movaCpu: boolean; kv?: string; context?: number; mtp?: boolean }): VramProfile | undefined {
      return vramProfilesFor(id).find((p) =>
        p.cpuMoe === cur.cpuMoe && p.movaCpu === cur.movaCpu &&
        (p.kv === undefined || p.kv === cur.kv) &&
        (p.context === undefined || p.context === cur.context) &&
        (p.mtp === undefined || !!p.mtp === !!cur.mtp))
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
