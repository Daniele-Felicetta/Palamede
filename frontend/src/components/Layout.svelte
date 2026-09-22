<script lang="ts">
  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import { route, navigate } from '../router.svelte'
  import { store, getCurrent, modelLabel } from '../store.svelte'
  import { SECTIONS } from '../data/sections'
  import { Button, Led, Meter } from './ui'
  import { get3DStatus, start3D, stop3D, type TrellisStatus } from '../api'

  // Marcatore di build: compare nel footer, cosi' si capisce subito se il
  // browser sta servendo un bundle vecchio (in tal caso: Ctrl+F5).
  const BUILD = 'v0.22'

  let theme = $state<'dark' | 'light'>(
    (() => { try { return (localStorage.getItem('palamede-theme') as 'dark' | 'light') || 'dark' } catch { return 'dark' } })()
  )
  $effect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('palamede-theme', theme) } catch { /* no storage */ }
  })

  let { children }: { children: Snippet } = $props()

  let sidebar = $state(typeof window !== 'undefined' ? window.innerWidth >= 1400 : true)

  // stato del server 3D TRELLIS (subprocess gestito dal hub)
  let trellis = $state<TrellisStatus | null>(null)
  let trellisBusy = $state(false)
  let trellisHint = $state('')

  async function pollTrellis() {
    try { trellis = await get3DStatus() } catch { /* hub non ancora vivo */ }
  }
  async function toggleTrellis() {
    if (trellisBusy) return
    trellisBusy = true; trellisHint = ''
    try {
      trellis = trellis?.running ? await stop3D() : await start3D()
    } catch (e) {
      trellisHint = String(e instanceof Error ? e.message : e)
    } finally {
      trellisBusy = false
    }
  }
  onMount(() => {
    pollTrellis()
    const t = setInterval(pollTrellis, 5000)
    return () => clearInterval(t)
  })

  let gpuOk = $derived(store.metrics?.gpu.ok)
  let loaded = $derived(getCurrent())
  let shellCls = $derived(
    (sidebar ? 'shell shell-sidebar' : 'shell')
    + (route.path === '/chat' ? ' chat-shell' : '')
    + (route.path === '/images' ? ' route-images' : '')
  )

</script>

<div class={shellCls}>
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
        <Led state="on" />
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
        <Led state="on" />
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
        <Led state={trellis?.running ? 'on' : 'off'} title="Server 3D TRELLIS.2" />
        <Button variant="server" onclick={toggleTrellis} disabled={trellisBusy}>
          {trellisBusy ? '…' : (trellis?.running ? 'stop' : 'start')}
        </Button>
      </div>
      {#if trellis?.ready}<div class="side-mini">pipeline pronta</div>{/if}
      {#if !trellis?.ready && trellis?.running && trellis?.loading}<div class="side-mini">in caricamento…</div>{/if}
      {#if trellisHint}<div class="side-mini off">{trellisHint}</div>{/if}
    </div>
    {#if (store.metrics?.gpu.procs?.length ?? 0) > 0}
      <div class="side-sec">
        <div class="side-title">Processi GPU</div>
        {#each store.metrics!.gpu.procs as p, i (i)}
          <div class="side-mini">
            <span title={p.name}>{p.name.split(/[\\/]/).pop()}</span>
            <span
              class={p.mem === '?' ? 'procs-mem na' : 'procs-mem'}
              title={p.mem === '?' ? 'VRAM non riportata da nvidia-smi' : p.mem}
            >
              {p.mem === '?' ? '—' : p.mem}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </aside>
  {#if sidebar}<div class="side-backdrop" onclick={() => sidebar = false} aria-hidden="true"></div>{/if}

  <main>{@render children()}</main>
  <footer>
    <span>Palamede — officina locale · RTX 5060 Ti 16GB</span>
    <span>modello server :8000 · hub :4600 · <span class="build-tag">{BUILD}</span></span>
  </footer>
</div>
