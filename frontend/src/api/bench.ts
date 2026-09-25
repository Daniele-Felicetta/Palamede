// Benchmark dei modelli testuali (outputs/benchmark/summary.json via hub).
// Prodotto da scripts/bench-text.mjs: velocità (llama-bench) + qualità (eval set).
export interface BenchRow {
  id: string
  name: string
  pp: number | null       // prompt processing, t/s
  tg: number | null       // generazione, t/s
  q: number | null        // qualità, 0..1
  loadMs: number | null
  speedNorm: number | null
  combined: number | null
  byCategory?: Record<string, number | null>
  qualityConfig?: { ngl?: number; ncmoe?: number | null; cpuMoe?: boolean; movaCpu?: boolean } | null
}

export interface BenchRank { pos: number; id: string; val: number }

export interface BenchSummary {
  generatedAt: string
  hardware: string
  evalCount?: number
  categories?: string[]
  method?: { speed: string; quality: string }
  rows: BenchRow[]
  byQuality: BenchRank[]
  bySpeed: BenchRank[]
  byCombined: BenchRank[]
}

/** null quando non è stato registrato alcun benchmark (hub → 404). */
export async function getBench(): Promise<BenchSummary | null> {
  const r = await fetch('/api/bench')
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ── Benchmark modelli immagine ──────────────────────────────────────────
export interface ImageBenchTime { coldMs: number; warmMs: number }
export interface ImageBenchQuality {
  score: number
  axes: { prompt_adherence: number; realism_quality: number; artifacts: number }
  byPrompt: { promptId: string; composite?: number }[]
}
export interface ImageBenchImage { promptId: string; prompt: string; file: string; timeMs: number; seed: number }

export interface ImageBenchRow {
  id: string
  name: string
  steps: number
  note: string
  loadMs: number | null
  s512: ImageBenchTime | null
  s1024: ImageBenchTime | null
  sps512: number | null      // immagini al secondo (warm, 512²)
  q: number | null           // qualità 0..10
  axes: ImageBenchQuality['axes'] | null
  images: ImageBenchImage[]
  speedNorm?: number | null
  combined?: number | null
}

export interface ImageBenchSummary {
  generatedAt: string
  hardware: string
  evalCount?: number
  method?: { speed: string; quality: string }
  rows: ImageBenchRow[]
  byQuality: BenchRank[]
  bySpeed: BenchRank[]
  byCombined: BenchRank[]
}

/** null quando non è stato registrato alcun benchmark immagini. */
export async function getImageBench(): Promise<ImageBenchSummary | null> {
  const r = await fetch('/api/bench-images')
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** URL dell'immagine generata servita dal hub. */
export function benchImageUrl(model: string, file: string): string {
  const name = file.split('/').pop() || file
  return `/api/bench-images/file/${model}/${name}`
}
