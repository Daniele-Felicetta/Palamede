// Contesto knowledge base per la chat (pattern llm-wiki).
// Estratto da Chat.svelte: cerca le pagine wiki rilevanti per una domanda e
// costruisce il system prompt con citazioni. Errore silenzioso → null (chat
// senza contesto). Riusabile da Bandersketch o futuri agenti.

import { getKbStatus, readKbFile, searchKb } from '../api'

const PAGE_SNIPPET = 4000
const INDEX_FALLBACK = 3000

/** System prompt con le pagine wiki rilevanti, o null se niente da iniettare. */
export async function buildKbContext(question: string): Promise<string | null> {
  try {
    const st = await getKbStatus()
    const pages = (await searchKb(question)).pages
    const parts: string[] = []
    if (pages.length) {
      for (const p of pages) {
        try {
          const f = await readKbFile('wiki/' + p)
          parts.push(`\n## ${p}\n${f.content.slice(0, PAGE_SNIPPET)}`)
        } catch { /* pagina non leggibile, skip */ }
      }
    } else if (st.wiki > 0) {
      // nessuna pagina rilevante: dai almeno l'indice al modello
      parts.push('\n' + st.index.slice(0, INDEX_FALLBACK))
    }
    if (!parts.length) return null
    return `Hai una knowledge base locale (wiki in knowledge/). Usala per rispondere: cita le fonti tra parentesi, non inventare. Ecco le pagine rilevanti per questa domanda:${parts.join('\n')}`
  } catch {
    return null
  }
}
