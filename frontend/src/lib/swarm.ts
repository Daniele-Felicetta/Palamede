// Stormo di agenti — logica di dominio pura (namespace `Swarm`, come `Text`).
// Qui SOLO prompt, validazione e parsing: niente fetch, niente stato.

export namespace Swarm {
  export interface Subtask { id: string; task: string }
  export interface Plan { subtasks: Subtask[] }
  export interface WorkResult { id: string; done: string }
  export interface Verdict { valid: number[]; note: string }
  export interface Synthesis { plan: string[] }

  export const PLAN_SYSTEM = `Sei un PIANIFICATORE. Dividi l'obiettivo in 3-4 sotto-task indipendenti e concreti, ciascuno con un id in snake_case.
Regole: nessuna premessa, nessuna spiegazione, niente markdown. Rispondi SOLO JSON.
Forma: {"subtasks":[{"id":"nome_corto","task":"cosa fare, in una riga"}]}`

  export const WORKER_SYSTEM = `Sei un ESECUTORE. Ti do UN sotto-task e un contesto. Rispondi SOLO JSON, niente prosa e niente markdown.
Forma: {"done":"risultato concreto in 1-2 frasi, in italiano"}`

  export const CRITIC_SYSTEM = `Sei un CRITICO severo. Ti do sotto-task e risultati numerati. Segnala SOLO i risultati che rispondono davvero al proprio sotto-task.
Rispondi SOLO JSON, niente prosa. Forma: {"valid":[1,3],"note":"motivo in mezza frase"}`

  export const SYNTH_SYSTEM = `Sei un SINTETIZZATORE. Unisci i risultati verificati in un piano operativo ordinato per fasi.
Rispondi SOLO JSON, niente prosa e niente markdown. Forma: {"plan":["fase 1","fase 2","fase 3"]}`

  /** Estrae il primo oggetto JSON dal testo (un 2B spesso aggiunge prosa
   *  attorno). Restituisce il valore o il motivo del fallimento. */
  export function extractJson<T>(text: string): { value: T | null; error: string } {
    const cleaned = text.replace(/```json/gi, '```')
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] !== '{') continue
      const end = matchBrace(cleaned, i)
      if (end === -1) continue
      try {
        return { value: JSON.parse(cleaned.slice(i, end + 1)) as T, error: '' }
      } catch {
        /* non è il nostro oggetto: continua a scansionare */
      }
    }
    return { value: null, error: 'nessun JSON valido nella risposta' }
  }

  /** Indice della `}` che chiude la `{` a `start`, ignorando le graffe
   *  dentro le stringhe. */
  function matchBrace(text: string, start: number): number {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  /** Problemi di un piano (array di stringhe leggibili: sono il prompt del
   *  passaggio di repair). Piano valido = 2-5 sotto-task con id e task. */
  export function validatePlan(plan: Plan | null): string[] {
    const problems: string[] = []
    if (!plan || !Array.isArray(plan.subtasks)) return ['"subtasks" manca o non è un array']
    const ids = plan.subtasks.map((s) => s?.id ?? '')
    if (ids.length < 2) problems.push('servono da 2 a 5 sotto-task')
    if (ids.length > 5) problems.push('massimo 5 sotto-task')
    plan.subtasks.forEach((s, i) => {
      if (!/^[a-z][a-z_]{1,30}$/.test(ids[i])) problems.push(`subtask ${i + 1}: id non valido "${ids[i]}"`)
      if (typeof s?.task !== 'string' || s.task.trim().length < 5) {
        problems.push(`subtask ${i + 1}: "task" troppo corto`)
      }
    })
    if (new Set(ids).size !== ids.length) problems.push('id duplicati')
    return problems
  }

  /** Prompt di riparazione mirato (2° colpo): il 2B sbaglia la forma, non
   *  l'intento — gli si dicono solo i problemi. */
  export function repairPrompt(problems: string[]): string {
    return `Correggi SOLO questi problemi e rispondi di nuovo con il solo oggetto JSON:\n- ${problems.join('\n- ')}`
  }

  /** Tiene solo i risultati che il critico ha validato, nel suo ordine. */
  export function verified(results: WorkResult[], valid: number[]): WorkResult[] {
    const keep = new Set(valid.map((i) => i - 1))
    return results.filter((_, i) => keep.has(i))
  }

  /** Pool: esegue `fn` su `items` con al massimo `limit` in volo, restituendo
   *  i risultati nell'ordine d'origine. */
  export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let next = 0
    const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    })
    await Promise.all(lanes)
    return out
  }
}