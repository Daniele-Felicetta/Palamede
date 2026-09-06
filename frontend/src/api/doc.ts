// Documentazione del progetto (MAPPA/README/SPEC/SECURITY servite dal hub).
export interface DocResult { name: string; text: string }

export async function getDoc(name: 'mappa' | 'readme' | 'spec' | 'security'): Promise<DocResult> {
  const r = await fetch(`/api/doc?name=${name}`)
  if (!r.ok) throw new Error(`documento ${name}: HTTP ${r.status}`)
  return r.json()
}
