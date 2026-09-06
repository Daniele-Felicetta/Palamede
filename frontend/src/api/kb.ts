import type { ChatStatus } from './chat'
import { j, postJson } from './http'

// ── knowledge base (llm-wiki: raw/ → wiki/ compilata dal modello) ────────

export interface KbFileInfo { name: string; bytes: number; mtime: number }
export interface KbStatus {
  ok: boolean
  raw: number
  wiki: number
  index: string
  log: string
  schema: string
  chat: ChatStatus
}
export interface KbFiles { area: string; files: KbFileInfo[] }
export interface KbRead { path: string; content: string }
export interface KbEmbeddings { available: boolean; models: string[] }
export interface KbIngestResult { ok: boolean; written: string[] }
export interface KbSearchResult { query: string; pages: string[] }

export async function getKbStatus(): Promise<KbStatus> {
  return j(await fetch('/api/kb/status', { cache: 'no-store' }))
}

export async function getKbFiles(area: 'raw' | 'wiki'): Promise<KbFiles> {
  return j(await fetch(`/api/kb/files?area=${area}`, { cache: 'no-store' }))
}

export async function readKbFile(path: string): Promise<KbRead> {
  return j(await fetch(`/api/kb/read?path=${encodeURIComponent(path)}`, { cache: 'no-store' }))
}

export async function saveKbFile(path: string, content: string): Promise<void> {
  await postJson('/api/kb/save', { path, content })
}

export async function deleteKbFile(path: string): Promise<boolean> {
  const d = await postJson<{ ok: boolean }>('/api/kb/delete', { path })
  return !!d.ok
}

export async function ingestKbSource(source: string): Promise<KbIngestResult> {
  return postJson('/api/kb/ingest', { source })
}

export async function searchKb(query: string): Promise<KbSearchResult> {
  return j(await fetch(`/api/kb/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' }))
}

export async function getKbEmbeddings(): Promise<KbEmbeddings> {
  return j(await fetch('/api/kb/embeddings', { cache: 'no-store' }))
}
