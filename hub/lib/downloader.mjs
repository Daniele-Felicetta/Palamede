// Palamede hub — downloader dei modelli dal frontend.
// Scarica in models/ i file di un modello del catalogo (scripts/models.catalog.json)
// con curl (URL ufficiali) o copia da reference/; un job alla volta, progresso
// leggibile da /api/downloader/status. Nessun URL arbitrario: solo quelli del
// catalogo, indicizzati per id (niente SSRF).

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync, mkdirSync, copyFileSync, unlinkSync, rmSync, createReadStream, readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { destAbs, loadCatalog } from './catalog.mjs'

let job = null
let child = null

function findModel(id) {
  for (const g of loadCatalog().groups) for (const m of g.models) if (m.id === id) return m
  return null
}

function sizeOf(file) { try { return statSync(file).size } catch { return 0 } }

function dirSize(dir) {
  let total = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      total += e.isDirectory() ? dirSize(p) : sizeOf(p)
    }
  } catch { /* assente */ }
  return total
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

function snapshot() {
  if (!job) return { state: 'idle' }
  const proc = job.files.filter((f) => f.process)
  const bytesTotal = proc.reduce((s, f) => s + (f.sizeBytes || f.bytesDone || 0), 0)
  const bytesDone = proc.reduce((s, f) => s + (f.bytesDone || 0), 0)
  const cur = job.files[job.index]
  return {
    state: job.state,
    modelId: job.modelId,
    model: job.model,
    error: job.error,
    index: job.index,
    total: job.files.length,
    bytesDone,
    bytesTotal,
    current: cur ? { name: cur.name, state: cur.state, bytesDone: cur.bytesDone, sizeBytes: cur.sizeBytes } : null,
    files: job.files.map((f) => ({ name: f.name, state: f.state, sizeBytes: f.sizeBytes, bytesDone: f.bytesDone, note: f.note || null })),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

function download(f) {
  return new Promise((resolve, reject) => {
    mkdirSync(dirname(f.dest), { recursive: true })
    f.state = 'scaricando'
    const c = spawn('curl.exe', ['-L', '--fail', '--retry', '3', '-s', '-o', f.dest, f.url], { windowsHide: true })
    child = c
    const timer = setInterval(() => { f.bytesDone = sizeOf(f.dest) }, 400)
    c.on('exit', async (code) => {
      clearInterval(timer); child = null
      if (job.state === 'cancelled') {
        // download interrotto: elimina il parziale, altrimenti verrebbe
        // scambiato per "presente" al prossimo avvio.
        try { unlinkSync(f.dest) } catch {}
        reject(new Error('annullato')); return
      }
      if (code !== 0) {
        // download incompleto: elimina il parziale, altrimenti verrebbe
        // scambiato per "presente" al prossimo avvio (esistenza = installato).
        try { unlinkSync(f.dest) } catch {}
        reject(new Error(`download fallito (curl ${code}): ${f.name}`)); return
      }
      f.bytesDone = sizeOf(f.dest)
      if (f.sha256) {
        const got = await sha256(f.dest)
        if (got !== f.sha256.toLowerCase()) {
          try { unlinkSync(f.dest) } catch {}
          reject(new Error(`SHA256 non corrisponde per ${f.name}`)); return
        }
      }
      f.state = 'fatto'
      resolve()
    })
    c.on('error', (e) => { clearInterval(timer); child = null; reject(e) })
  })
}

function copyDir(f) {
  return new Promise((resolve, reject) => {
    f.state = 'copiando'
    const c = spawn('robocopy', [destAbs(f.copyDir), f.dest, '/E', '/XD', '.cache', '/NFL', '/NDL', '/NJH', '/NP'], { windowsHide: true })
    child = c
    const timer = setInterval(() => { f.bytesDone = dirSize(f.dest) }, 800)
    c.on('exit', (code) => {
      clearInterval(timer); child = null
      if (job.state === 'cancelled') {
        try { rmSync(f.dest, { recursive: true, force: true }) } catch {}
        reject(new Error('annullato')); return
      }
      if (code >= 8) { reject(new Error(`copia fallita (robocopy ${code})`)); return }
      f.state = 'fatto'; f.bytesDone = dirSize(f.dest); resolve()
    })
    c.on('error', (e) => { clearInterval(timer); child = null; reject(e) })
  })
}

async function runJob() {
  for (let i = 0; i < job.files.length; i++) {
    job.index = i
    if (job.state === 'cancelled') return
    const f = job.files[i]
    if (!f.process) continue
    if (f.kind === 'url') await download(f)
    else if (f.kind === 'copy') { mkdirSync(dirname(f.dest), { recursive: true }); copyFileSync(destAbs(f.copy), f.dest); f.state = 'fatto'; f.bytesDone = sizeOf(f.dest) }
    else if (f.kind === 'copyDir') await copyDir(f)
    else { f.state = 'saltato'; f.note = 'sorgente manuale' }
  }
  job.state = 'done'
  job.finishedAt = Date.now()
}

export function downloadStatus() { return snapshot() }

export function startDownload(id) {
  if (job && job.state === 'downloading') throw new Error('un download è già in corso')
  const model = findModel(id)
  if (!model) throw new Error('modello sconosciuto: ' + id)
  const files = model.files.map((raw) => {
    const dest = destAbs(raw.dest)
    const present = existsSync(dest)
    const kind = raw.manual ? 'manual' : raw.url ? 'url' : raw.copy ? 'copy' : raw.copyDir ? 'copyDir' : 'unknown'
    return {
      dest, name: dest.split(sep).pop(), url: raw.url, copy: raw.copy, copyDir: raw.copyDir,
      sha256: raw.sha256, sizeBytes: raw.sizeBytes || 0,
      bytesDone: present ? sizeOf(dest) : 0,
      state: present ? 'presente' : 'in coda',
      process: !present,
      kind,
    }
  })
  job = { state: 'downloading', modelId: id, model: model.name, files, index: 0, startedAt: Date.now(), finishedAt: null, error: null }
  runJob().catch((e) => {
    if (job.state === 'cancelled') return // gia' segnato come annullato
    job.state = 'error'; job.error = String(e?.message || e); job.finishedAt = Date.now()
  })
  return snapshot()
}

export function cancelDownload() {
  if (!job || job.state !== 'downloading') return snapshot()
  job.state = 'cancelled'
  if (child) { try { child.kill() } catch {} }
  job.finishedAt = Date.now()
  return snapshot()
}
