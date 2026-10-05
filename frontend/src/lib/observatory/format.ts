// Palamede — Osservatorio: formattazione dei numeri.
//
// I numeri qui vengono da misure su 229 milioni di parametri: le norme vanno
// da 1e-5 a 1e3 e i delta da 1e-7 a 1e-2. Un `toFixed(2)` mostrava tutto
// come "0.00" o "18394.21" a seconda del caso, quindi ogni funzione dichiara
// il proprio formato e resta coerente tra pannelli.

const NBSP = ' '

/** Intero con separatori italiani: 229.693.184 */
export function int(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('it-IT')
}

/**
 * Norme, gradienti, delta: notazione adattiva.
 * 0.0234 → "0.0234" · 1.8e-5 → "1.80e-5" · 234 → "234.0"
 */
export function num(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a === 0) return '0'
  if (a < 1e-4 || a >= 1e6) return n.toExponential(2).replace('e', 'e')
  if (a < 1) return n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
  if (a < 100) return n.toFixed(2)
  return n.toFixed(1)
}

/** Percentuale con 3 decimali: 0.0045 → "0.004%" */
export function pct(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (Math.abs(n) < 1e-3) return `${n.toExponential(2)}%`
  return `${n.toFixed(digits)}%`
}

/** Millisecondi: 0.83 → "0.83 ms" · 1234 → "1.23 s" */
export function ms(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(2)}${NBSP}s` : `${n.toFixed(1)}${NBSP}ms`
}

/** MiB di VRAM: 5303 → "5.2 GB" */
export function mib(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n >= 1024 ? `${(n / 1024).toFixed(2)}${NBSP}GB` : `${n.toFixed(0)}${NBSP}MiB`
}

/** Forma di un tensore: [1024, 1024] */
export function shape(s: number[] | undefined | null): string {
  if (!s || !s.length) return '—'
  return `[${s.join(' × ')}]`
}

/** Token: mostra gli spazi iniziali che il tokenizer conserva davvero. */
export function token(t: string): string {
  if (t === '') return '∅'
  return t.replace(/^ /, '·').replace(/\n/g, '⏎').replace(/\t/g, '→')
}

/** Testo troncato con puntini, per le celle strette. */
export function clip(s: string | null | undefined, max = 48): string {
  const v = (s ?? '').replace(/\s+/g, ' ').trim()
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`
}

/** Orario locale da un timestamp epoch (secondi). */
export function clock(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleTimeString('it-IT', { hour12: false })
}

/** 0..1 → barra di 8 blocchi, per il profilo per layer. */
export function bar(v: number, width = 8): string {
  const n = Math.max(0, Math.min(width, Math.round(v * width)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

/** Quante cifre servono per distinguere due numeri vicini. */
export function sig(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n) || n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 0.001 && a < 1e5) return n.toPrecision(digits).replace(/\.?0+$/, '')
  return n.toExponential(digits - 1)
}
