import type { ChatStatus } from './chat'
import { j, postJson } from './http'

// ── knowledge base RAG (stile NotebookLM: raw/ → chunk + embedding → retrieve) ─

export interface KbSourceInfo {
  name: string
  slug: string
  bytes: number
  chunks: number
  embedded: boolean
  updated: number
}

export interface KbChunkHit {
  id: string
  source: string
  section: string
  text: string
  start: number
  end: number
  score: number
}

export interface KbRetrieveSource { name: string; path: string }

export interface KbRetrieveResult {
  query: string
  reranked: boolean
  chunks: KbChunkHit[]
  sources: KbRetrieveSource[]
}

export interface KbRerankStatus {
  running: boolean
  ready: boolean
  pid: number | null
  model: string
  uses: number
  file: string
  error: string | null
}

export interface KbStatus {
  ok: boolean
  raw: number
  chunks: number
  embedded: number
  sources: KbSourceInfo[]
  chat: ChatStatus
  embeddings: { available: boolean; models: string[] }
  rerank: KbRerankStatus
}

export interface KbFileInfo { name: string; bytes: number; mtime: number }
export interface KbFiles { area: string; files: KbFileInfo[] }
export interface KbRead { path: string; content: string }
export interface KbEmbeddings { available: boolean; models: string[] }
export interface KbIngestResult { source: string; chunks: number; embedded: boolean; fallbackKeyword: boolean; replaced: number }

export async function getKbStatus(): Promise<KbStatus> {
  return j(await fetch('/api/kb/status', { cache: 'no-store' }))
}

export async function getKbFiles(area: 'raw'): Promise<KbFiles> {
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

/** Upload di una fonte: salva in raw/ e la indicizza subito (chunk + embedding). */
export async function uploadKbSource(name: string, content: string): Promise<KbIngestResult> {
  return postJson('/api/kb/upload', { name, content })
}

/** Ingest (o re-indicizzazione) di una fonte già in raw/. */
export async function ingestKbSource(source: string): Promise<KbIngestResult> {
  return postJson('/api/kb/ingest', { source })
}

/** Ricerca ibrida (keyword + vettoriale): ispezione nella UI. */
export async function searchKb(query: string): Promise<{ query: string; chunks: KbChunkHit[] }> {
  return j(await fetch(`/api/kb/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' }))
}

/** Retrieval completo (ibrido + rerank MiniCPM) per la chat grounded. */
export async function retrieveKb(query: string, topK = 5): Promise<KbRetrieveResult> {
  return postJson('/api/kb/retrieve', { query, topK })
}

export async function getKbEmbeddings(): Promise<KbEmbeddings> {
  return j(await fetch('/api/kb/embeddings', { cache: 'no-store' }))
}

export async function getKbRerank(): Promise<KbRerankStatus> {
  return j(await fetch('/api/kb/rerank', { cache: 'no-store' }))
}

export async function startKbRerank(): Promise<{ ok: boolean; status: KbRerankStatus }> {
  return postJson('/api/kb/rerank/start', {})
}

export async function stopKbRerank(): Promise<KbRerankStatus> {
  return j(await fetch('/api/kb/rerank/stop', { method: 'POST' }))
}