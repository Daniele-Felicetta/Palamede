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
import { get3DStatus, getChatStatus, getHealth, getMetrics, getModels, getServerMetrics, selectModel, type ChatStatus, type Health, type Metrics, type ModelsStatus, type ServerMetrics, type TrellisStatus } from './api'
import { Images } from './lib/images'

export const store = $state({
  health: null as Health | null,
  models: null as ModelsStatus | null,
  metrics: null as Metrics | null,
  chat: null as ChatStatus | null,
  trellis: null as TrellisStatus | null,
  server: null as ServerMetrics | null,
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
let timer: ReturnType<typeof setTimeout> | null = null
// Backoff: dopo errori consecutivi (hub spento) il giro rallenta fino a 15 s,
// così la UI spenta non martella il loopback. Al primo successo torna a 3 s.
let fails = 0
const BASE_MS = 3000
const MAX_MS = 15000

async function tick() {
  // niente overlap: se il giro precedente è ancora in volo (hub sotto carico),
  // salta questo (il poller riprova al giro dopo). A scheda nascosta, niente poll.
  if (ticking) return
  if (typeof document !== 'undefined' && document.hidden) return schedule()
  ticking = true
  try {
    // In parallelo, non in sequenza: sei round-trip seriali sotto carico
    // sommano i timeout e l'UI resta indietro di secondi. Ognuno azzera il suo
    // campo in caso d'errore (niente valori stantii spacciati per vivi).
    const [health, models, metrics, chat, trellis, server] = await Promise.allSettled([
      getHealth(), getModels(), getMetrics(), getChatStatus(), get3DStatus(), getServerMetrics(),
    ])
    const errs: string[] = []
    if (health.status === 'fulfilled') store.health = health.value
    else { store.health = null; errs.push('health: ' + msg(health.reason)) }
    if (models.status === 'fulfilled') store.models = models.value
    else { store.models = null; errs.push('models: ' + msg(models.reason)) }
    if (metrics.status === 'fulfilled') store.metrics = metrics.value
    else { store.metrics = null; errs.push('metrics: ' + msg(metrics.reason)) }
    // chat, 3D e server testuale sono silenziosi: il hub risponde anche a
    // server spenti, e a hub non ancora pronto il campo resta null senza
    // sporcare lastError.
    store.chat = chat.status === 'fulfilled' ? chat.value : null
    store.trellis = trellis.status === 'fulfilled' ? trellis.value : null
    store.server = server.status === 'fulfilled' ? server.value : null
    store.lastError = errs.length ? errs.join(' · ') : null
    fails = errs.length >= 3 ? fails + 1 : 0
  } finally {
    ticking = false
  }
  schedule()
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function delay(): number {
  return Math.min(BASE_MS * 2 ** Math.min(fails, 3), MAX_MS)
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, delay())
}

function poke() {
  // Rientro sulla scheda o ritorno online: giro subito, senza aspettare il timer.
  fails = 0
  if (!ticking) void tick()
}

// Il poller parte all'import del modulo: Layout monta sempre, quindi l'app
// lo usa per forza. Niente subscribe manuale come in React.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poke() })
  window.addEventListener('online', poke)
}
tick()

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