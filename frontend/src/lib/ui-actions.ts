// Azioni e helper UI condivisi dalle pagine (prima duplicati in Chat.svelte).
// Niente dipendenze: solo DOM + Svelte actions.

// Focus + selezione per gli input che compaiono al volo (rinomina chat…).
export function focusInput(node: HTMLInputElement) {
  node.focus()
  node.select()
  return {}
}

// Focus sul contenitore del modale all'apertura (chiusura con Escape).
export function focusModal(node: HTMLElement) {
  node.focus()
  return {}
}

// Textarea che cresce col testo fino a un tetto, poi scrolla dentro.
export function fitTextarea(el: HTMLTextAreaElement | null | undefined, max = 200) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, max) + 'px'
}

export function flatTextarea(el: HTMLTextAreaElement | null | undefined) {
  if (el) el.style.height = ''
}
