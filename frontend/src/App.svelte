<script lang="ts">
  import type { Component } from 'svelte'
  import Layout from './components/Layout.svelte'
  import Draft from './components/Draft.svelte'
  import { DRAFTS } from './data/wiki'
  import { route } from './router.svelte'

  // ── Auto-routing ───────────────────────────────────────────────────────
  // Ogni file in pages/*.svelte diventa una rotta da solo, niente righe da
  // aggiungere qui:
  //   Home.svelte     → '/'
  //   Images.svelte   → /images      (nome file in minuscolo)
  //   Progetto.svelte → /progetto
  //   Games.svelte    → /games
  //
  // Quindi per aggiungere una pagina basta:
  //   1. creare src/pages/Nome.svelte (copia una pagina esistente)
  //   2. aggiungere la voce in src/data/sections.ts (per il menu e le card)
  // Le bozze senza pagina (3D, MCP…) finiscono su <Draft> via DRAFTS.
  const pageModules = import.meta.glob('./pages/*.svelte', { eager: true })
  const pages = new Map<string, Component>()
  for (const file of Object.keys(pageModules)) {
    const name = file.split('/').pop()!.replace(/\.svelte$/, '')
    const href = name === 'Home' ? '/' : `/${name.toLowerCase()}`
    pages.set(href, (pageModules[file] as { default: Component }).default)
  }

  let Page = $derived(pages.get(route.path) ?? null)
  let draft = $derived(DRAFTS.find((d) => d.path === route.path) ?? null)
  let Home = $derived(pages.get('/')!)
</script>

<Layout>
  {#if Page}
    <Page />
  {:else if draft}
    <Draft draft={draft} />
  {:else}
    <Home />
  {/if}
</Layout>