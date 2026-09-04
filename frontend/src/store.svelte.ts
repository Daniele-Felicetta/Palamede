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
import { getChatStatus, getHealth, getMetrics, getModels, selectModel, type ChatStatus, type Health, type Metrics, type ModelsStatus } from './api'
import { Images } from './lib/images'

export const store = $state({
  health: null as Health | null,
  models: null as ModelsStatus | null,
  metrics: null as Metrics | null,
  chat: null as ChatStatus | null,
  selecting: null as string | null,
  lastError: null as string | null,
})

const current = $derived(store.models?.current ?? null)

/** Modello attualmente caricato sulla GPU (null se VRAM vuota).
 *  Getter: i componenti lo leggono dentro un proprio $derived. */
export const getCurrent = (): string | null => current

export const modelLabel = Images.modelLabel

async function tick() {
  const errs: string[] = []
  try { store.health = await getHealth() } catch (e) { errs.push('health: ' + (e instanceof Error ? e.message : String(e))) }
  try { store.models = await getModels() } catch (e) { errs.push('models: ' + (e instanceof Error ? e.message : String(e))) }
  try { store.metrics = await getMetrics() } catch (e) { errs.push('metrics: ' + (e instanceof Error ? e.message : String(e))) }
  try { store.chat = await getChatStatus() } catch { /* chat non ancora supportata dal hub */ }
  store.lastError = errs.length ? errs.join(' · ') : null
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