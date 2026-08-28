// Store condiviso dell'officina: UN solo poller per tutta l'app (health +
// modelli + metriche ogni 3 s), così sidebar, home e immagini mostrano lo
// stesso stato — niente più led "attivo" stantii o modelli desincronizzati.
//
// switchModel() è il punto unico di cambio modello: scarica il precedente e
// carica il nuovo in un colpo solo (il server lo fa da sé su /select), quindi
// NON serve mai premere prima un "eject".
import { useEffect, useReducer } from 'react'
import { getHealth, getMetrics, getModels, selectModel, Health, Metrics, ModelsStatus } from './api'

export const MODEL_LABEL: Record<string, string> = {
  bonsai: 'Bonsai 4B T',
  zimage: 'Z-Image Q4',
}

let health: Health | null = null
let models: ModelsStatus | null = null
let metrics: Metrics | null = null
let selecting: string | null = null
let started = false
const listeners = new Set<() => void>()

function emit() { listeners.forEach((l) => l()) }

async function tick() {
  try { health = await getHealth() } catch { health = null }
  try { models = await getModels() } catch { models = null }
  try { metrics = await getMetrics() } catch { metrics = null }
  emit()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (!started) {
    started = true
    tick()
    setInterval(tick, 3000)
  }
  return () => { listeners.delete(fn) }
}

export function useStore() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribe(force), [])
  return {
    health,
    models,
    metrics,
    selecting,
    current: models?.current ?? null,
    modelLabel: (id: string) => MODEL_LABEL[id] ?? id,
  }
}

/** Cambia modello in un colpo solo (scarica + carica). Idempotente. */
export async function switchModel(id: string): Promise<ModelsStatus | null> {
  if (selecting) return null
  if (models?.current === id) return models
  selecting = id
  emit()
  try {
    models = await selectModel(id)
    return models
  } finally {
    selecting = null
    emit()
  }
}

/** Ri-sincronizza lo stato modelli dal server (es. dopo una generazione). */
export async function refreshModels() {
  try { models = await getModels() } catch { /* il poller riprova */ }
  emit()
}