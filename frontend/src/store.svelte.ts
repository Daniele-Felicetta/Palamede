// Store condiviso dell'officina: UN solo poller per tutta l'app (health +
// modelli + metriche ogni 3 s), così sidebar, home e immagini mostrano lo
// stesso stato — niente più led "attivo" stantii o modelli desincronizzati.
//
// In Svelte 5 lo stato reattivo condiviso vive in un file .svelte.ts con
// runes a livello di modulo: `store` è un oggetto $state unico per l'app,
// letto direttamente dai componenti (reattività automatica).
//
// switchModel() è il punto unico di cambio modello: scarica il precedente e
// carica il nuovo in un colpo solo (il server lo fa da sé su /select), quindi
// NON serve mai premere prima un "eject".
import { get3DStatus, getChatStatus, getHealth, getMetrics, getModels, selectModel, type ChatStatus, type Health, type Metrics, type ModelsStatus, type TrellisStatus } from './api'
import { Images } from './lib/images'

export const store = $state({
  health: null as Health | null,
  models: null as ModelsStatus | null,
  metrics: null as Metrics | null,
  chat: null as ChatStatus | null,
  trellis: null as TrellisStatus | null,
  selecting: null as string | null,
  lastError: null as string | null,
})

/** Modello attualmente caricato sulla GPU (null se VRAM vuota).
 *  Getter: legge lo store al momento della chiamata, così i componenti che lo
 *  usano dentro un proprio $derived tracciano `store.models` da soli (niente
 *  $derived a livello di modulo, che sarebbe condiviso e non tracciabile). */
export const getCurrent = (): string | null => store.models?.current ?? null

export const modelLabel = Images.modelLabel

let ticking = false
async function tick() {
  // niente overlap: se il giro precedente è ancora in volo (hub sotto carico),
  // salta questo (il poller riprova tra 3 s). A scheda nascosta, niente poll.
  if (ticking) return
  if (typeof document !== 'undefined' && document.hidden) return
  ticking = true
  try {
    const errs: string[] = []
    // Su errore si AZZERA il campo, non si lascia il valore vecchio: altrimenti
    // l'UI mostra metriche e stato "accesi" come se fossero vivi, e "hub non
    // raggiungibile" (che testa health === null) non compare mai.
    try { store.health = await getHealth() } catch (e) { store.health = null; errs.push('health: ' + (e instanceof Error ? e.message : String(e))) }
    try { store.models = await getModels() } catch (e) { store.models = null; errs.push('models: ' + (e instanceof Error ? e.message : String(e))) }
    try { store.metrics = await getMetrics() } catch (e) { store.metrics = null; errs.push('metrics: ' + (e instanceof Error ? e.message : String(e))) }
    try { store.chat = await getChatStatus() } catch { store.chat = null /* hub non ancora pronto */ }
    // stato del server 3D: silenzioso (il hub risponde anche a server spento)
    try { store.trellis = await get3DStatus() } catch { store.trellis = null /* hub non vivo */ }
    store.lastError = errs.length ? errs.join(' · ') : null
  } finally {
    ticking = false
  }
}

// Il poller parte all'import del modulo: Layout monta sempre, quindi l'app
// lo usa per forza. Niente subscribe manuale come in React.
tick()
setInterval(tick, 3000)

/** Cambia modello in un colpo solo (scarica + carica). Idempotente. */
export async function switchModel(id: string): Promise<ModelsStatus | null> {
  if (store.selecting) return null
  if (store.models?.current === id) return store.models
  store.selecting = id
  try {
    store.models = await selectModel(id)
    return store.models
  } finally {
    store.selecting = null
  }
}

/** Ri-sincronizza lo stato modelli dal server (es. dopo una generazione). */
export async function refreshModels() {
  try { store.models = await getModels() } catch { /* il poller riprova */ }
}