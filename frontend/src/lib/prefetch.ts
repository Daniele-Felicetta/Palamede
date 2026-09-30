// Prefetch dei chunk pagina: stesso glob lazy di App.svelte, senza duplicare
// la mappa delle rotte. `prefetchPage('/chat')` scarica il chunk in cache:
// al click il loader risolve subito. Errori ignorati (pagina bozza o chunk
// già pronto). Niente import statici: tutto resta code-split.
type PageMod = { default: unknown }
const loaders = import.meta.glob<PageMod>('../pages/*.svelte')

const byHref = new Map<string, () => Promise<PageMod>>()
for (const file of Object.keys(loaders)) {
  const name = file.split('/').pop()!.replace(/\.svelte$/, '')
  byHref.set(name === 'Home' ? '/' : `/${name.toLowerCase()}`, loaders[file] as () => Promise<PageMod>)
}

const done = new Set<string>()

export function prefetchPage(path: string): void {
  if (done.has(path)) return
  done.add(path)
  byHref.get(path)?.().catch(() => {})
}
