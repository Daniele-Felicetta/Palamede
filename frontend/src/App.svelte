<script lang="ts">
  import type { Component } from 'svelte'
  import Layout from './components/Layout.svelte'
  import Draft from './components/Draft.svelte'
  import { DRAFTS } from './data/wiki'
  import { route, navigate, titleFor } from './router.svelte'
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
  // Bandersketch: setup in /bandersketch, gioco in /bandersketch/<genere>
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

  const gameRoute = /^\/bandersketch\/([^/]+)$/
  // Teatro: le rotte del gioco escono dal Layout officina (niente masthead,
  // sidebar, footer) e occupano tutto lo schermo con frontend dedicato.
  let isGameRoute = $derived(route.path === '/bandersketch' || gameRoute.test(route.path))
  // Rotta esistente? Pagina auto-routata, setup/gioco Bandersketch o bozza
  // wiki. Tutto il resto è 404 vera (prima ricadeva in silenzio sulla Home,
  // confondendo: URL sbagliato = Home identica a quella giusta).
  let knownRoute = $derived(
    byHref.has(route.path)
    || route.path === '/bandersketch'
    || gameRoute.test(route.path)
    || DRAFTS.some((d) => d.path === route.path),
  )
  let Page = $state<Component | null>(null)
  let loadErr = $state('')
  let navToken = 0

  $effect(() => {
    const path = route.path
    // Titolo scheda + ritorno in cima a ogni cambio rotta (la chat gestisce
    // il proprio scroll interno: il Layout le dà una shell a parte).
    if (typeof document !== 'undefined') document.title = titleFor(path)
    if (typeof window !== 'undefined' && path !== '/chat') window.scrollTo(0, 0)
    const loader =
      byHref.get(path) ??
      (path === '/bandersketch' ? setupLoader : null) ??
      (gameRoute.test(path) ? gameLoader : null) ??
      null
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

  function retry() {
    // Ricarica il chunk fallito ripassando dalla stessa rotta.
    const path = route.path
    loadErr = ''
    Page = null
    const t = ++navToken
    const loader =
      byHref.get(path)
      ?? (path === '/bandersketch' ? setupLoader : null)
      ?? (gameRoute.test(path) ? gameLoader : null)
    loader?.().then(
      (m) => { if (t === navToken) Page = m.default },
      (e) => { if (t === navToken) { Page = null; loadErr = String(e?.message ?? e) } },
    )
  }

  // Prefetch a riposo: i chunk di Immagini/Chat (le due pagine pesanti più
  // visitate) si scaricano quando il browser è idle, così il primo click non
  // paga il round-trip. Il loader è cached: nessun doppio montaggio.
  if (typeof window !== 'undefined') {
    const idle = (fn: () => void) =>
      'requestIdleCallback' in window
        ? (window as Window & { requestIdleCallback: (c: () => void) => void }).requestIdleCallback(fn)
        : setTimeout(fn, 2500)
    idle(() => {
      byHref.get('/images')?.().catch(() => {})
      byHref.get('/chat')?.().catch(() => {})
    })
  }
  let draft = $derived(DRAFTS.find((d) => d.path === route.path) ?? null)
</script>

{#if isGameRoute}
  {#if Page}
    <Page />
  {:else if loadErr}
    <p class="route-err" role="alert">Pagina non caricata: {loadErr} <button type="button" class="route-retry" onclick={retry}>riprova</button></p>
  {:else}
    <p class="route-loading" aria-busy="true"><span class="route-spinner" aria-hidden="true"></span>caricamento…</p>
  {/if}
{:else}
<Layout>
  {#if !knownRoute}
    <section class="route-404" aria-label="Pagina non trovata">
      <p class="eyebrow">Errore 404</p>
      <h1>Niente qui, <em>solo trucioli</em>.</h1>
      <p class="lede">La rotta <code>{route.path}</code> non esiste. Torna all'officina o scegli una sezione dal menu.</p>
      <p><a class="app-go" href="#/" onclick={(e) => { e.preventDefault(); navigate('/') }}>torna all'officina →</a></p>
    </section>
  {:else if draft}
    <Draft draft={draft} />
  {:else if Page}
    <Page />
  {:else if loadErr}
    <p class="route-err" role="alert">Pagina non caricata: {loadErr} <button type="button" class="route-retry" onclick={retry}>riprova</button></p>
  {:else}
    <p class="route-loading" aria-busy="true"><span class="route-spinner" aria-hidden="true"></span>caricamento…</p>
  {/if}
</Layout>
{/if}

<style>
  .route-loading, .route-err { padding: 40px 8px; color: var(--paper-dim); display: flex; align-items: center; gap: 10px; }
  .route-err { color: var(--seal); }
  .route-spinner {
    width: 14px; height: 14px; flex: none; border-radius: 50%;
    border: 2px solid var(--line); border-top-color: var(--accent);
    animation: route-spin .8s linear infinite;
  }
  @keyframes route-spin { to { transform: rotate(360deg); } }
  .route-retry {
    font-family: var(--mono); font-size: 11px; letter-spacing: .6px;
    background: var(--ink-3); color: var(--paper);
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: 5px 12px;
  }
  .route-retry:hover { border-color: var(--accent); color: var(--accent); }
  .route-404 { max-width: 62ch; padding: 40px 8px; }
  .route-404 code { font-family: var(--mono); font-size: .85em; background: var(--ink-3); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
  .route-404 .app-go { display: inline-block; margin-top: 14px; color: var(--accent); }
  @media (prefers-reduced-motion: reduce) {
    .route-spinner { animation: none; border-top-color: var(--line); }
  }
</style>