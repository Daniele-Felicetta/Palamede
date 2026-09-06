<script lang="ts">
  import type { Component } from 'svelte'
  import Layout from './components/Layout.svelte'
  import Draft from './components/Draft.svelte'
  import { DRAFTS } from './data/wiki'
  import { route } from './router.svelte'
  // Setup/Bandersketch arrivano via dynamic import (chunk gioco separato).

  // ── Auto-routing LAZY ────────────────────────────────────────────────
  // Ogni file in pages/*.svelte diventa una rotta da solo, niente righe da
  // aggiungere qui (ma caricata solo quando la visiti → chunk separati):
  //   Home.svelte     → '/'
  //   Images.svelte   → /images      (nome file in minuscolo)
  //   Progetto.svelte → /progetto
  //   Games.svelte    → /games
  //
  // Quindi per aggiungere una pagina basta:
  //   1. creare src/pages/Nome.svelte (copia una pagina esistente)
  //   2. aggiungere la voce in src/data/sections.ts (per il menu e le card)
  // Le bozze senza pagina (MCP…) finiscono su <Draft> via DRAFTS.
  // Bandersketch: setup in /bandersketch, gioco in /bandersnatch/<genere>
  // (rotta dinamica, chunk separato dal resto).
  type PageMod = { default: Component }
  const pageLoaders = import.meta.glob<PageMod>('./pages/*.svelte')
  const byHref = new Map<string, () => Promise<PageMod>>()
  for (const file of Object.keys(pageLoaders)) {
    const name = file.split('/').pop()!.replace(/\.svelte$/, '')
    const href = name === 'Home' ? '/' : `/${name.toLowerCase()}`
    byHref.set(href, pageLoaders[file] as () => Promise<PageMod>)
  }
  const setupLoader = () => import('./games/bandersketch/src/Setup.svelte')
  const gameLoader = () => import('./games/bandersketch/src/Bandersketch.svelte')

  const gameRoute = /^\/bandersnatch\/([^/]+)$/
  let Page = $state<Component | null>(null)
  let loadErr = $state('')
  let navToken = 0

  $effect(() => {
    const path = route.path
    const loader =
      byHref.get(path) ??
      (path === '/bandersketch' ? setupLoader : null) ??
      (gameRoute.test(path) ? gameLoader : null) ??
      byHref.get('/') // rotta sconosciuta: ricadi sulla Home
    if (!loader) { Page = null; return }
    const t = ++navToken
    loadErr = ''
    // trattieni la pagina precedente mentre la nuova si carica (niente flash):
    // Page resta quella vecchia finché il chunk non arriva.
    loader().then(
      (m) => { if (t === navToken) Page = m.default },
      (e) => { if (t === navToken) { Page = null; loadErr = String(e?.message ?? e) } },
    )
  })
  let draft = $derived(DRAFTS.find((d) => d.path === route.path) ?? null)
</script>

<Layout>
  {#if draft}
    <Draft draft={draft} />
  {:else if Page}
    <Page />
  {:else if loadErr}
    <p class="route-err" role="alert">Pagina non caricata: {loadErr}</p>
  {:else}
    <p class="route-loading" aria-busy="true">caricamento…</p>
  {/if}
</Layout>

<style>
  .route-loading, .route-err { padding: 40px 8px; color: var(--paper-dim); }
  .route-err { color: var(--seal); }
</style>