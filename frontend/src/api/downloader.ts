// Downloader modelli (pagina Downloader): catalogo del hub + job di download.
export type BenchLabel = 'consigliato' | 'alternativa' | 'sconsigliato'

export interface DownloaderSource { label: string; url: string | null }

export interface DownloaderModel {
  id: string
  name: string
  label: BenchLabel
  role: string
  quality: string
  speed: string
  vram: string
  requires: string
  sizeBytes: number
  installed: boolean
  missing: number
  files: number
  sources: DownloaderSource[]
}

export interface DownloaderGroup {
  id: string
  label: string
  hint: string
  models: DownloaderModel[]
}

export interface DownloaderCatalog { groups: DownloaderGroup[]; hardware: string }

export interface DownloadFile {
  name: string
  state: string          // in coda | scaricando | copiando | fatto | presente | saltato
  sizeBytes: number
  bytesDone: number
  note: string | null
}

export interface DownloadStatus {
  state: 'idle' | 'downloading' | 'done' | 'error' | 'cancelled'
  modelId?: string
  model?: string
  error?: string | null
  index?: number
  total?: number
  bytesDone?: number
  bytesTotal?: number
  current?: { name: string; state: string; bytesDone: number; sizeBytes: number } | null
  files?: DownloadFile[]
  startedAt?: number
  finishedAt?: number | null
}

export async function getDownloader(): Promise<DownloaderCatalog> {
  const r = await fetch('/api/downloader')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function getDownloadStatus(): Promise<DownloadStatus> {
  const r = await fetch('/api/downloader/status')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function post(path: string, body: unknown): Promise<DownloadStatus> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`)
  return data as DownloadStatus
}

export function startDownload(id: string): Promise<DownloadStatus> {
  return post('/api/downloader/download', { id })
}

export function cancelDownload(): Promise<DownloadStatus> {
  return post('/api/downloader/cancel', {})
}
