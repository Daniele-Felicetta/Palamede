<script lang="ts">
  import type { Snippet } from 'svelte'
  import { route, navigate } from '../router.svelte'
  import { store, getCurrent, modelLabel } from '../store.svelte'
  import { SECTIONS } from '../data/sections'
  import { Button, Led, Meter } from './ui'
  import { start3D, stop3D } from '../api'
  import { prefetchPage as prefetch } from '../lib/prefetch'

  // Marcatore di build: compare nel footer, cosi' si capisce subito se il
  // browser sta servendo un bundle vecchio (in tal caso: Ctrl+F5). Allineato
  // alla versione dell'app (src-tauri/tauri.conf.json).
  const BUILD = 'v0.19'

  // Tema: preferenza salvata, altrimenti quella del sistema (l'officina è dark
  // di default solo se il sistema non dice altro). `colorScheme` allinea anche
  // scrollbar e controlli nativi al tema.
  let theme = $state<'dark' | 'light'>(
    (() => {
      try {
        const saved = localStorage.getItem('palamede-theme') as 'dark' | 'light' | null
        if (saved) return saved
      } catch { /* no storage */ }
      if (typeof window !== 'undefined' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) return 'light'
      return 'dark'
    })()
  )
  $effect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('palamede-theme', theme) } catch { /* no storage */ }
  })

  let { children }: { children: Snippet } = $props()

  // Sidebar: stesso breakpoint del CSS (1200px) e preferenza persistita. Su
  // schermi stretti parte sempre chiusa (è un overlay, non un riquadro).
  let sidebar = $state(
    (() => {
      if (typeof window === 'undefined') return true
      if (window.innerWidth < 1200) return false
      try { return localStorage.getItem('palamede-sidebar') !== '0' } catch { return true }
    })()
  )
  $effect(() => {
    try { localStorage.setItem('palamede-sidebar', sidebar ? '1' : '0') } catch { /* no storage */ }
  })

  // Stato del server 3D TRELLIS: arriva dallo store condiviso (un solo poller
  // per l'app, come chat/modelli). Qui solo start/stop, che scrivono l'esito.
  let trellisBusy = $state(false)
  let trellisHint = $state('')

  async function toggleTrellis() {
    if (trellisBusy) return
    trellisBusy = true; trellisHint = ''
    try {
      store.trellis = store.trellis?.running ? await stop3D() : await start3D()
    } catch (e) {
      trellisHint = String(e instanceof Error ? e.message : e)
    } finally {
      trellisBusy = false
    }
  }

  let gpuOk = $derived(store.metrics?.gpu.ok)
  let loaded = $derived(getCurrent())
  // Nome corto del modello servito dal llama-server (dal path, senza .gguf),
  // come nella pagina Server. Null se spento o senza path.
  let srvModel = $derived.by(() => {
    const p = store.server?.props?.modelPath
    if (!p) return store.server?.model ?? null
    return (p.split(/[\\/]/).pop() ?? p).replace(/\.gguf$/i, '')
  })
  let shellCls = $derived(
    (sidebar ? 'shell shell-sidebar' : 'shell')
    + (route.path === '/chat' ? ' chat-shell' : '')
    + (route.path === '/images' ? ' route-images' : '')
  )

  // Prefetch al passaggio del mouse: `prefetch` (lib) scarica il chunk della
  // pagina in cache, al click il loader risolve subito. Niente import statici:
  // le pagine restano chunk lazy separati.
  // Escape chiude la sidebar su schermi stretti (dove è un overlay).
  $effect(() => {
    if (!sidebar) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && typeof window !== 'undefined' && window.innerWidth < 1200) sidebar = false
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

</script>

<div class={shellCls}>
  <a class="skip-link" href="#contenuto" onclick={(e) => { e.preventDefault(); document.getElementById('contenuto')?.focus() }}>salta al contenuto</a>
  <header class="masthead">
    <a class="brand" href="#/" onclick={(e) => { e.preventDefault(); navigate('/') }}>
      <img class="seal" src="/palamede_icon.png" alt="Palamede" />
      Palamede
    </a>
    <nav class="nav" aria-label="Sezioni">
      {#each SECTIONS as n (n.path)}
        <a
          href="#{n.path}"
          class="{(route.path === n.path ? 'active ' : '') + (n.live ? '' : 'disabled')}"
          aria-current={route.path === n.path ? 'page' : undefined}
          aria-disabled={!n.live || undefined}
          onmouseenter={() => prefetch(n.path)}
          onfocus={() => prefetch(n.path)}
          onclick={(e) => { e.preventDefault(); navigate(n.path) }}
        ><svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html n.icon}</svg>{n.label}</a>
      {/each}
    </nav>
    <div class="beacon" role="status" aria-label="Stato dell'officina">
      <span class="led-row" title="Modello server attivo">
        <Led state={store.health?.ok ? 'on' : 'off'} />
        {store.health?.ok ? 'officina accesa' : 'officina spenta'}
      </span>
      <span class="led-row" title="Modello caricato in VRAM">
        <Led state={loaded ? 'on' : 'off'} />
        {loaded ? modelLabel(loaded) : 'VRAM vuota'}
      </span>
      <span class="led-row" title="Uso della GPU">
        <span class="log-bar" aria-hidden="true">
          <span class="log-fill" style:width="{Math.min(100, gpuOk ? store.metrics!.gpu.utilPct : 0)}%"></span>
        </span>
        GPU {gpuOk ? `${Math.round(store.metrics!.gpu.utilPct)}%` : store.metrics ? 'n/d' : '…'}
      </span>
      <span class="led-row" title="CPU e RAM">
        CPU {store.metrics ? `${Math.round(store.metrics.cpu)}%` : '…'} · RAM {store.metrics ? `${store.metrics.ram.pct}%` : '…'}
        {#if store.lastError}<span class="hub-err" title={store.lastError}>⚠ {store.lastError}</span>{/if}
      </span>
    </div>
    <Button
      variant="side"
      onclick={() => theme = theme === 'dark' ? 'light' : 'dark'}
      title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
      aria-pressed={theme === 'light'}
    >
      {theme === 'dark' ? '☀ chiaro' : '☾ scuro'}
    </Button>
    <Button
      variant="side"
      onclick={() => sidebar = !sidebar}
      title="Mostra/nascondi metriche"
      aria-pressed={sidebar}
    >
      {sidebar ? '◂ nascondi' : '▸ metriche'}
    </Button>
  </header>

  <aside class={sidebar ? 'sidebar open' : 'sidebar'} aria-label="Metriche di sistema">
    <div class="side-sec">
      <div class="side-title">Sistema</div>
      <Meter label="CPU" value={store.metrics?.cpu ?? 0} max={100} unit="%" />
      <Meter label="RAM" value={store.metrics?.ram.usedGB ?? 0} max={store.metrics?.ram.totalGB ?? 1} unit=" GB" />
    </div>
    <div class="side-sec">
      <div class="side-title">GPU</div>
      {#if gpuOk}
        <Meter label="Uso" value={store.metrics!.gpu.utilPct} max={100} unit="%" />
        <Meter label="VRAM" value={store.metrics!.gpu.vramUsedGB} max={store.metrics!.gpu.vramTotalGB} unit=" GB" />
        <div class="side-mini">
          <span>temp {store.metrics!.gpu.tempC}°C</span>
          <span>power {store.metrics!.gpu.powerW}W</span>
        </div>
      {:else if store.health === null}
        <div class="side-mini off">hub non raggiungibile — apri Palamede.exe</div>
      {:else if store.metrics}
        <div class="side-mini off">nvidia-smi non disponibile</div>
      {:else}
        <div class="side-mini">lettura…</div>
      {/if}
    </div>
    <div class="side-sec">
      <div class="side-title">Modello</div>
      <div class={`loaded-model ${loaded ? 'on' : ''}`}>
        <Led state={loaded ? 'on' : 'off'} />
        {loaded ? modelLabel(loaded) : 'nessuno'}
      </div>
    </div>
    <div class="side-sec">
      <div class="side-title">Server</div>
      <!-- backend :8000 -->
      <div class="srv-row">
        <span class="srv-name">backend :8000</span>
        <Led state={store.health?.ok ? 'on' : 'off'} title="Modello server" />
      </div>
      <!-- chat :8121 (solo led: start/stop dalla pagina Chat) -->
      <div class="srv-row">
        <span class="srv-name">chat :8121</span>
        <Led state={store.chat?.running ? 'on' : 'off'} title="Server chat llama.cpp" />
      </div>
      <!-- 3D :8124 con start/stop -->
      <div class="srv-row">
        <span class="srv-name">3D :8124</span>
        <Led state={store.trellis?.running ? 'on' : 'off'} title="Server 3D TRELLIS.2" />
        <Button variant="server" onclick={toggleTrellis} disabled={trellisBusy}>
          {trellisBusy ? '…' : (store.trellis?.running ? 'stop' : 'start')}
        </Button>
      </div>
      {#if store.trellis?.ready}<div class="side-mini">pipeline pronta</div>{/if}
      {#if !store.trellis?.ready && store.trellis?.running && store.trellis?.loading}<div class="side-mini">in caricamento…</div>{/if}
      {#if trellisHint}<div class="side-mini off">{trellisHint}</div>{/if}
    </div>
    <div class="side-sec">
      <div class="side-title">Server <span class="side-port">:{store.server?.port ?? '—'}</span></div>
      {#if store.server?.running}
        <div class="side-mini">
          <span title={store.server.props?.modelPath ?? ''}>{srvModel ?? 'modello'}</span>
          <span>
            {#if store.server.prefill != null}{Math.round(store.server.prefill.tps)}↑{:else}—{/if}
            {' · '}
            {#if store.server.liveDecode != null}{store.server.liveDecode.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}↓{:else if store.server.decode != null}{store.server.decode.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}↓{:else}—{/if}
          </span>
        </div>
        {#if store.server.live}
          <div class="side-mini">
            <span>slot {store.server.busySlot?.id ?? '?'} · prefill {Math.round(store.server.live.fraction * 100)}%</span>
            <span>{Math.round(store.server.live.tps)} tok/s</span>
          </div>
        {:else if store.server.liveDecode}
          <div class="side-mini">
            <span>slot {store.server.liveDecode.slot ?? store.server.busySlot?.id ?? '?'} · decode</span>
            <span>{store.server.liveDecode.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })} tok/s</span>
          </div>
        {:else if store.server.busySlot}
          <div class="side-mini">
            <span>slot {store.server.busySlot.id} · decode</span>
            <span>{store.server.decode ? store.server.decode.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'} tok/s</span>
          </div>
        {:else}
          <div class="side-mini off">in attesa</div>
        {/if}
      {:else if store.server}
        <div class="side-mini off">server spento</div>
      {:else}
        <div class="side-mini">lettura…</div>
      {/if}
    </div>
  </aside>
  {#if sidebar}<div class="side-backdrop" onclick={() => sidebar = false} aria-hidden="true"></div>{/if}

  <main id="contenuto" tabindex="-1">{@render children()}</main>
  <footer>
    <span>Palamede — officina locale · RTX 5060 Ti 16GB</span>
    <span>modello server :8000 · hub :4600 · <span class="build-tag">{BUILD}</span></span>
  </footer>
</div>
