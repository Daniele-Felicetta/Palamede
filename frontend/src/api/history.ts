import { j } from './http'

// ── cronologia immagini (persistente su outputs/history) ──────────────────

export interface HistoryEntry {
  id: string
  model: string
  prompt: string
  size: string
  seed: number
  steps: number
  timeMs: number
  ts: number
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return j(await fetch('/api/history', { cache: 'no-store' }))
}

export function historyImgUrl(id: string): string {
  return `/api/history/img/${encodeURIComponent(id)}`
}

export async function saveHistory(entry: {
  model: string
  prompt: string
  size: string
  seed: number
  steps: number
  timeMs: number
  dataUrl: string
}): Promise<void> {
  const r = await fetch('/api/history/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d?.error?.message || `HTTP ${r.status}`)
  }
}

export async function clearHistory(): Promise<void> {
  const r = await fetch('/api/history/clear', { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function deleteHistory(id: string): Promise<void> {
  const r = await fetch(`/api/history/delete/${encodeURIComponent(id)}`, { method: 'POST' })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d?.error?.message || `HTTP ${r.status}`)
  }
}
