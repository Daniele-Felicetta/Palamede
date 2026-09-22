// Libreria del dominio immagini: un unico namespace `Images` con tipi,
// costanti e funzioni pure riutilizzabili in tutto il progetto.
// Qui SOLO logica di dominio: niente fetch (vive in api.ts) e niente stato
// GPU (vive in store.svelte.ts).
//
// Uso:
//   import { Images } from './lib/images'
//   Images.modelName('bonsai')        → 'Bonsai'
//   Images.supportsImg2img('bonsai')  → false
//   let m: Images.ModelId = 'zimage'

export namespace Images {
  export type ModelId = 'bonsai' | 'zimage' | 'klein' | 'qwenimage'

  /** Preset di formato disponibili (valore · etichetta). */
  export const SIZES = [
    ['512x512', 'quadrata 1:1'],
    ['768x768', 'quadrata media'],
    ['896x896', 'quadrata alta'],
    ['1024x1024', 'quadrata HD'],
    ['640x416', 'paesaggio 3:2'],
    ['768x512', 'paesaggio 3:2 media'],
    ['1248x832', 'paesaggio 3:2 HD'],
    ['416x640', 'ritratto 2:3'],
    ['512x768', 'ritratto 2:3 media'],
    ['832x1248', 'ritratto 2:3 HD'],
  ] as const

  /** Step consigliati per modello. */
  export const DEFAULT_STEPS: Record<ModelId, number> = { bonsai: 4, zimage: 8, klein: 4, qwenimage: 40 }

  /** Nome breve del modello. */
  export const MODEL_NAMES: Record<ModelId, string> = {
    bonsai: 'Bonsai',
    zimage: 'Z-Image',
    klein: 'Klein',
    qwenimage: 'Qwen-Image',
  }

  /** Nome breve del modello (fallback: l'id stesso). */
  export function modelName(id: string): string {
    return MODEL_NAMES[id as ModelId] ?? id
  }

  /** true se il modello accetta image-to-image (init image + strength). */
  export function supportsImg2img(id: ModelId): boolean {
    return id !== 'bonsai'
  }

  /** '512x512' → [512, 512]; snap a multipli di 32 (vincolo VAE),
   *  clamp 64–2048; su formato non valido ripiega su 512². */
  export function parseSize(size: string): [number, number] {
    const [w, h] = size.split('x').map(Number)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return [512, 512]
    const snap = (v: number) => Math.min(2048, Math.max(64, Math.round(v / 32) * 32))
    return [snap(w), snap(h)]
  }

  /** true se il formato è tra i preset di SIZES. */
  export function isSizePreset(size: string): boolean {
    return SIZES.some(([v]) => v === size)
  }

  /** Legge un file immagine come dataURL (Promise). Rifiuta se il tipo
   *  non è image/* o se la lettura fallisce. */
  export function readImageAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('il file non è un\'immagine'))
        return
      }
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(new Error('lettura dell\'immagine fallita'))
      r.readAsDataURL(file)
    })
  }

  /** Riduce un dataURL via canvas (JPEG, max `max` px lato lungo): le immagini
   *  compatte pesano poco sul contesto dei modelli vision-language.
   *  Spostato qui da Bandersketch per riuso (anteprime, contesto visivo). */
  export function downscaleDataUrl(dataUrl: string, max = 448): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1))
        const w = Math.max(1, Math.round((img.width || 1) * scale))
        const h = Math.max(1, Math.round((img.height || 1) * scale))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) { reject(new Error('canvas non disponibile')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = () => reject(new Error('immagine non leggibile'))
      img.src = dataUrl
    })
  }

  /** Etichette "verbose" per sidebar/stato (id → nome descrittivo). */
  export const MODEL_LABELS: Record<ModelId, string> = {
    bonsai: 'Bonsai 4B T',
    zimage: 'Z-Image Q4',
    klein: 'Klein 4B Q4',
    qwenimage: 'Qwen-Image 2.1',
  }

  /** Etichetta descrittiva del modello (fallback: l'id stesso). */
  export function modelLabel(id: string): string {
    return MODEL_LABELS[id as ModelId] ?? id
  }

  /** Quantizzazione display per le piastrelle modello. */
  export const MODEL_QUANT: Record<ModelId, string> = {
    bonsai: '1.58-bit',
    zimage: 'Q4_K_M',
    klein: 'Q4',
    qwenimage: 'Q4_K_M',
  }

  /** Stamp "N step · quant" per le piastrelle modello. */
  export function modelStamp(id: ModelId): string {
    return `${DEFAULT_STEPS[id]} step · ${MODEL_QUANT[id]}`
  }

  /** Tagline di una riga per le piastrelle modello. */
  export const MODEL_TAGLINE: Record<ModelId, string> = {
    bonsai: '512² in 1.8 s — il più veloce',
    zimage: 'testo nell\'immagine, fotorealismo spinto',
    klein: 'img2img nativo · 2,5 GB · ~1.8 s',
    qwenimage: '7B · editing e trasparenza · 40 step',
  }

  /** Tagline del modello (fallback: stringa vuota). */
  export function modelTagline(id: ModelId): string {
    return MODEL_TAGLINE[id] ?? ''
  }
}
