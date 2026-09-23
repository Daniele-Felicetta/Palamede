// Logica RAG lato client (stile NotebookLM): costruzione del system prompt
// grounded, parsing delle citazioni [n], evidenziazione del chunk nella fonte.
// Pura (niente fetch: vive in api/kb.ts). Riusabile da Rag.svelte e Chat.svelte.

import type { KbRetrieveResult } from '../api'

const CHUNK_CTX = 700 // caratteri per frammento nel prompt di grounding

/** System prompt che chiede all'LLM di rispondere SOLO dai frammenti, citando
 *  [n] per ogni affermazione presa da una fonte. I frammenti sono numerati
 *  1..n nell'ordine del retrieval (dopo il rerank). */
export function buildGroundingSystem(retr: KbRetrieveResult): string {
  const parts = retr.chunks.map((c, i) => {
    const where = c.section ? ` · sezione "${c.section}"` : ''
    return `[${i + 1}] (${c.source}${where}) ${c.text.slice(0, CHUNK_CTX)}`
  })
  return [
    'Hai una knowledge base locale. Rispondi SOLO usando i frammenti seguenti,',
    'attribuendo ogni affermazione alla fonte con una citazione [n] (n = numero',
    'del frammento). Se la risposta non è nei frammenti, scrivi esattamente',
    '"non è nei tuoi documenti". Non inventare nulla che non sia nei frammenti.',
    '',
    ...parts,
  ].join('\n')
}

/** Estrae i numeri di citazione [n] da un testo di risposta (ordinati, unici). */
export function extractCites(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && !out.includes(n)) out.push(n)
  }
  return out
}

/** Evidenzia il chunk [start,end) del testo di una fonte: escape HTML, poi
 *  <mark> sul range richiesto. Mostra un po' di contesto attorno al chunk. */
export function renderHighlighted(text: string, start: number, end: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const pad = 600
  const s = Math.max(0, start - pad)
  const e = Math.min(text.length, end + pad)
  const pre = esc(text.slice(s, start))
  const hit = esc(text.slice(start, Math.min(end, text.length)))
  const post = esc(text.slice(Math.min(end, text.length), e))
  const head = s > 0 ? '<span class="rag-ellipsis">…</span>' : ''
  const tail = e < text.length ? '<span class="rag-ellipsis">…</span>' : ''
  return `${head}<span class="rag-context">${pre}</span><mark class="rag-hit">${hit}</mark><span class="rag-context">${post}</span>${tail}`
}

/** Converte una risposta [n]-citata in una lista di {chunk, numero} per le
 *  source card, nell'ordine in cui appaiono nel testo. */
export function citedChunks(retr: KbRetrieveResult, text: string) {
  const cites = extractCites(text)
  return cites
    .map((n) => ({ n, chunk: retr.chunks[n - 1] }))
    .filter((c): c is { n: number; chunk: NonNullable<KbRetrieveResult['chunks'][number]> } => !!c.chunk)
}