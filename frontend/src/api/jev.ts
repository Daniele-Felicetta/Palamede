// JEV Hub: progetti sperimentali jev (elenco, avvio/arresto) via hub Palamede.
export interface JevProject {
  id: string
  name: string
  desc: string
  port: number
  url: string
  started: boolean
  running: boolean
  cwd: string
}
export interface JevProjects { root: string; running: boolean; items: JevProject[] }

export async function getJevProjects(): Promise<JevProjects> {
  const r = await fetch('/api/jev/projects')
  if (!r.ok) throw new Error(`jev projects: HTTP ${r.status}`)
  return r.json()
}

export async function jevProjectAction(id: string, action: 'start' | 'stop'): Promise<JevProject> {
  const r = await fetch(`/api/jev/projects/${id}/${action}`, { method: 'POST' })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e?.error?.message ?? `HTTP ${r.status}`)
  }
  return r.json()
}
