// Palamede hub — catalogo dei modelli (scripts/models.catalog.json).
// Unico punto che legge il catalogo condiviso con l'installer CLI: usato dal
// downloader del frontend e per annotare la disponibilità dei modelli.
// Non contiene logica di download (quella vive in downloader.mjs).

import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { ROOT } from './root.mjs'

const CATALOG_PATH = join(ROOT, 'scripts', 'models.catalog.json')
let cache = null

export function loadCatalog() {
  if (!cache) {
    // strip BOM: Notepad e compagnia lo aggiungono e JSON.parse lo rifiuta.
    cache = JSON.parse(readFileSync(CATALOG_PATH, 'utf8').replace(/^\uFEFF/, ''))
  }
  return cache
}

/** Path assoluto di un file del catalogo (i dest usano '/' come separatore). */
export function destAbs(rel) {
  return join(ROOT, rel.split('/').join(sep))
}

export function filePresent(f) {
  return existsSync(destAbs(f.dest))
}

/** true se tutti i file richiesti (non opzionali) sono presenti. */
export function modelInstalled(model) {
  const required = model.files.filter((f) => !f.optional)
  return required.length > 0 && required.every(filePresent)
}

/** id → true/false (disponibilità per le pagine che elencano modelli). */
export function availability() {
  const map = {}
  for (const g of loadCatalog().groups) {
    for (const m of g.models) map[m.id] = modelInstalled(m)
  }
  return map
}

/** Fonti di un modello (host/repo o reference), deduplicate. */
export function sourcesOf(model) {
  const out = new Map()
  for (const f of model.files) {
    if (f.url) {
      try {
        const u = new URL(f.url)
        const parts = u.pathname.split('/').filter(Boolean)
        const label = `${u.host}/${parts.slice(0, 2).join('/')}`
        out.set(label, `https://${label}`)
      } catch { /* url malformato: ignora */ }
    } else if (f.manual) {
      out.set('sorgente manuale', null)
    } else if (f.copy || f.copyDir) {
      const base = (f.copy || f.copyDir).split('/')[0]
      out.set(`${base}/ (locale)`, null)
    }
  }
  return [...out.entries()].map(([label, url]) => ({ label, url }))
}

/** Hardware misurato dal Banco (se presente): mai hardcodare, la UI lo mostra. */
function benchHardware() {
  for (const f of ['benchmark/summary.json', 'benchmark-images/summary.json']) {
    try {
      const h = JSON.parse(readFileSync(join(ROOT, 'outputs', f), 'utf8'))?.hardware
      if (h) return h
    } catch { /* summary assente */ }
  }
  return null
}

/** Elenco per la pagina Downloader: gruppi ordinati + stato + fonti. */
export function downloaderList() {
  const cat = loadCatalog()
  const groups = cat.groups.map((g) => ({
    id: g.id,
    label: g.label,
    hint: g.hint,
    models: g.models.map((m) => {
      const missing = m.files.filter((f) => !f.optional && !filePresent(f))
      return {
        id: m.id,
        name: m.name,
        label: m.label,
        role: m.role,
        quality: m.quality,
        speed: m.speed,
        vram: m.vram,
        requires: m.requires || `${m.vram} VRAM`,
        sizeBytes: m.sizeBytes || 0,
        installed: modelInstalled(m),
        missing: missing.length,
        files: m.files.length,
        sources: sourcesOf(m),
      }
    }),
  }))
  return { groups, hardware: benchHardware() }
}
