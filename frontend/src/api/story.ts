import { j } from './http'

// Client verso l'archivio partite di Bandersketch (:4600 /api/stories).
// Ogni partita salva snapshot con testi, scene, seed e tavole (PNG su disco).

export interface StoryChapterEntry {
  n: number
  text: string
  scene: string
  prompt: string // frammento che l'ha generato (dataset futuro)
  rating: number // 1 👍 · -1 👎 · 0 non votato
  seed: number
  timeMs: number
  img: string // nome file, es. 'ch2.png'
}

export interface StoryOptionEntry {
  label: string
  scene: string
  prompt: string // frammento del bivio (dataset futuro)
  seed: number
  timeMs: number
  img: string // es. 'ch2a.png'
}

export interface StoryForkEntry {
  chapter: number
  options: StoryOptionEntry[]
  picked: number | null
}

export interface StorySummary {
  id: string
  genre: string
  name: string
  narrator: string
  painter: string
  chapters: number
  choices: number
  created: number
  updated: number
}

export interface StoryDetail {
  id: string
  meta: Record<string, string>
  chapters: StoryChapterEntry[]
  forks: StoryForkEntry[]
  created: number
  updated: number
}

export interface StorySnapshot {
  id: string
  meta: Record<string, string>
  chapters: StoryChapterEntry[]
  forks: StoryForkEntry[]
  images: Record<string, string> // nome file -> dataUrl (solo PNG)
}

export async function listStories(): Promise<StorySummary[]> {
  return j(await fetch('/api/stories'))
}

export async function getStory(id: string): Promise<StoryDetail> {
  return j(await fetch(`/api/stories/${encodeURIComponent(id)}`))
}

export function storyImage(id: string, file: string): string {
  return `/api/stories/${encodeURIComponent(id)}/img/${encodeURIComponent(file)}`
}

export async function saveStory(snap: StorySnapshot): Promise<{ ok: boolean; id: string }> {
  return j(await fetch('/api/stories/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snap),
  }))
}

export async function deleteStory(id: string): Promise<{ ok: boolean }> {
  return j(await fetch(`/api/stories/delete/${encodeURIComponent(id)}`, { method: 'POST' }))
}
