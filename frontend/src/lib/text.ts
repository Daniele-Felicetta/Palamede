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
  export type ModelId = 'ornith-35b' | 'ornith-9b' | 'ornith-9b-q5' | 'k2-7b' | 'k2-36b' | 'bonsai-27b' | 'lfm-vl-3b' | 'lfm-24a2b' | 'gemma-4-26b' | 'gemma-4-12b' | 'minicpm5-2b' | 'qwen38-27b' | 'minicpm-v47-35b' | 'pocket-darwin-180b' | 'nemotron-bolt-74b' | 'nemotron-bolt-74b-q2'

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
      id: 'lfm-24a2b',
      name: 'LFM2.5 24B-A2B',
      family: 'Liquid AI · MoE 64 esperti, 4 attivi',
      quant: 'UD-Q5_K_XL',
      diskGB: '16.7 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      // Arch nativa `lfm2moe`, ctx nativo 131072, tetto pratico come Qwen3.8.
      context: 32768,
      kv: 'q8_0',
      gpuLayers: 99,
      mtp: false,
      cpuMoe: 30,
      // Il GGUF dichiara sampling temp 0.1 / top_k 50 (la UI espone solo
      // temperature); 0.3 e' il compromesso chat, non thinking model.
      temperature: 0.3,
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
      id: 'minicpm-v47-35b',
      name: 'MiniCPM-V 4.7 35B-A3B',
      family: 'OpenBMB · MoE 256 esperti, 8 attivi · vision-text',
      quant: 'Q4_K_M',
      diskGB: '19.7 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      // Stessa arch del resto della famiglia (`qwen35moe`, ctx nativo 262144).
      // Tetto pratico 131072 come Qwen3.8 27B: oltre, la KV satura i 16 GB VRAM.
      // Banco: 93,3% qualita' e 56 t/s con ncmoe 30 (~9,5 GB VRAM).
      context: 32768,
      kv: 'q8_0',
      gpuLayers: 99,
      // Spec-decode OFF di default: misurato su RTX 5060 Ti 16 GB (ncmoe 30,
      // 250 token, temp 0) 47,1 t/s senza draft contro 40,9 t/s con dspark
      // (acceptance 0,30, mean len 1,60: il costo del draft supera il guadagno).
      // Resta disponibile dal pannello per prove future.
      mtp: false,
      cpuMoe: 30,
      // Il GGUF dichiara sampling temp 1.0 / top_k 20 / top_p 0.95 (la UI
      // espone solo temperature). Non e' un thinking model.
      temperature: 1.0,
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
    {
      id: 'nemotron-bolt-74b',
      name: 'Nemotron 3.5 Bolt 74B-A9B',
      family: 'NVIDIA · ibrido SSM+attenzione · MoE latente',
      quant: 'UD-Q3_K_XL',
      diskGB: '36.3 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      // Solo 8 layer su 88 hanno attenzione piena (40 sono SSM, 40 MoE a
      // proiezione latente): la KV costa 64 KB/token a q8_0 invece dei ~250
      // dei modelli densi, e con la config veloce resta ~9 GB di VRAM anche a
      // 131k. 131k è il tetto in maxContext (nativo 262144) e il default.
      context: 131072,
      kv: 'q4_0',
      gpuLayers: 99,
      // Spec-decode ON di default (head dflash 1,1B in VRAM): nel config veloce la
      // GPU ha tempo libero mentre la CPU lavora sugli esperti, e il draft ci
      // sta dentro. Misure a cache calda (2 run per config): decode 17,4 →
      // 23,7 t/s a prompt corto (+36%) e 21,5 → 27,0 t/s a 6k di prompt
      // (+25%), prefill -4/-8%. Nella config LENTA (--n-cpu-moe) il
      // guadagno spariva: la CPU era già satura e il draft peggiorava tutto.
      mtp: true,
      // Gli esperti routed vanno in CPU, ma NON con --n-cpu-moe: l'hub usa il
      // caso speciale -ot (solo *_exps/gate_inp/exp_probs_b) che lascia gli
      // shared expert in VRAM. Con cpuMoe > 0 attivi la regola; a 0 tutti gli
      // esperti in VRAM, che non ci stanno (36,3 GB su 16,3 di VRAM).
      cpuMoe: 40,
      temperature: 1.0,
      thinking: true,
    },
    {
      id: 'nemotron-bolt-74b-q2',
      name: 'Nemotron 3.5 Bolt 74B-A9B (Q2)',
      family: 'NVIDIA · ibrido SSM+attenzione · MoE latente · leggero',
      quant: 'UD-Q2_K_XL',
      diskGB: '26.8 GB',
      moe: true,
      mova: false,
      movaCpu: false,
      // 26,8 GB invece di 36,3: esperti in IQ3_XXS. Serve quando i 36 GB non
      // stanno in RAM. Non e' piu' veloce (il collo e' sempre la CPU sugli
      // esperti) e la qualita' cala: per questo il Q3 resta il default.
      context: 131072,
      kv: 'q4_0',
      gpuLayers: 99,
      mtp: true,
      cpuMoe: 40,
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

  /** Nemotron 3.5 Bolt 74B-A9B: la variante veloce sta nel `-ot` sui soli
   *  tensori per-esperto (hub/lib/chat.mjs), NON in --n-cpu-moe: 3,6 → 17,6
   *  t/s e la VRAM scende da 15,6 a 9,1 GB, quindi il contesto lungo costa
   *  quasi nulla. Misure su RTX 5060 Ti 16 GB + 64 GB RAM (b11707, KV q4_0,
   *  thinking off; la VRAM è quella totale col desktop acceso):
   *    --n-cpu-moe 40, 32k ....... 15,6 GB · 3,6 t/s    <- la config lenta
   *    -ot routed, 32k ...........  9,1 GB · 17,6 t/s · prefill 21,8 t/s
   *    -ot routed, 131k ..........  9,5 GB · 17,4 t/s
   *    -ot + draft dflash, 131k ..  ~9,5 GB · 27,0 t/s su 6k di prompt
   *    Q2_K_XL, -ot, 32k .........  8,6 GB · 16,9 t/s
   *    Q2_K_XL, -ot, 131k ........  9,0 GB · 19,5 t/s
   *  Tutte le misure con cache CALDA (dopo una richiesta di riscaldamento):
   *  la prima dopo il load legge ~25 GB di esperti da NVMe e vale la metà. */
  export const NEMOTRON_PROFILES: VramProfile[] = [
    {
      id: 'long-131k',
      label: 'Contesto lungo (131k, KV q4)',
      hint: '131k contesto · ~9,5 GB VRAM · ~17,4 t/s (27 con draft)',
      cpuMoe: 40, movaCpu: false, kv: 'q4_0', context: 131072, mtp: true,
    },
    {
      id: 'standard',
      label: 'Standard (32k, KV q8)',
      hint: '32k contesto · ~11 GB VRAM · ~17,6 t/s (24 con draft)',
      cpuMoe: 40, movaCpu: false, kv: 'q8_0', context: 32768, mtp: true,
    },
    {
      id: 'no-draft',
      label: 'Senza draft (prefill più veloce)',
      hint: '131k contesto · ~9,5 GB VRAM · ~17,4 t/s, prefill +8%',
      cpuMoe: 40, movaCpu: false, kv: 'q4_0', context: 131072, mtp: false,
    },
  ]

  /** Profili VRAM disponibili per un modello. */
  export function vramProfilesFor(id: string): VramProfile[] {
    if (supportsMova(id)) return K2_36B_PROFILES
    if (id === 'pocket-darwin-180b') return DARWIN_PROFILES
    if (id === 'qwen38-27b') return QWEN38_PROFILES
    if (id === 'nemotron-bolt-74b' || id === 'nemotron-bolt-74b-q2') return NEMOTRON_PROFILES
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
