import { j, postJson } from './http'

// ── TRELLIS.2 image-to-3D (via hub :4600 → venv trellis :8124) ─────────────

export interface TrellisStatus {
  running: boolean // subprocess del hub vivo (server :8124 raggiungibile)
  ready: boolean // pipeline caricata in VRAM (true dopo il primo carico)
  loading: boolean // true mentre carica per la prima volta (mantenuto per compatibilità)
  pid: number | null
  load_time_s: number | null // secondi di caricamento della pipeline (se già avviata)
}

export interface Generate3DResult {
  glb_base64: string // data:model/gltf-binary;base64,...
  path: string
  url: string // /api/3d/file/<id>.glb
  stl_url: string // /api/3d/file/<id>.stl (solo geometria)
  vertices: number
  faces: number
  time_s: number
  vram_peak_gb: number
  seed: number
  pipeline_type: string
}

export interface Generate3DRequest {
  image: string // dataUrl dell'immagine di partenza
  pipeline_type?: string // '512' (default) | '1024'
  seed?: number // -1 = casuale
  num_samples?: number // 1–4
}

export async function get3DStatus(): Promise<TrellisStatus> {
  return j(await fetch('/api/3d/status'))
}

export async function start3D(): Promise<TrellisStatus> {
  return postJson('/api/3d/start', {})
}

export async function stop3D(): Promise<TrellisStatus> {
  return postJson('/api/3d/stop', {})
}

export async function generate3D(req: Generate3DRequest): Promise<Generate3DResult> {
  return postJson('/api/3d/generate', {
    image: req.image,
    pipeline_type: req.pipeline_type ?? '512',
    seed: req.seed ?? -1,
    num_samples: req.num_samples ?? 1,
  })
}
