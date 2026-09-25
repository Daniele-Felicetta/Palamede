<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getDownloader, getDownloadStatus, startDownload, cancelDownload } from '../api'
  import type { DownloaderCatalog, DownloaderModel, DownloadStatus } from '../api'
  import { Button, Hintline, SectionHead, Stamp } from '../components/ui'

  let cat = $state<DownloaderCatalog | null>(null)
  let job = $state<DownloadStatus>({ state: 'idle' })
  let err = $state('')
  let loading = $state(true)
  let starting = $state<string | null>(null)
  let polling = false
  let destroyed = false

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
  const gb = (b: number) => (b / 1024 ** 3).toFixed(1)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function load() {
    try { cat = await getDownloader() } catch (e) { err = msg(e) } finally { loading = false }
  }
  async function sync() {
    try { job = await getDownloadStatus() } catch { /* hub giù */ }
  }

  async function pollLoop() {
    if (polling) return
    polling = true
    try {
      while (!destroyed) {
        await sync()
        if (job.state !== 'downloading') break
        await sleep(1200)
      }
      await load()
    } finally { polling = false }
  }

  async function boot() {
    await load()
    await sync()
    if (job.state === 'downloading') pollLoop()
  }

  onMount(() => { void boot() })
  onDestroy(() => { destroyed = true })

  async function download(m: DownloaderModel) {
    err = ''
    starting = m.id
    try { job = await startDownload(m.id); pollLoop() }
    catch (e) { err = msg(e) }
    finally { starting = null }
  }

  async function annulla() {
    try { job = await cancelDownload() } catch (e) { err = msg(e) }
    await load()
  }

  const labelCls = (l: string) => `dl-tag dl-${l}`
  const labelText = (l: string) => (l === 'consigliato' ? 'consigliato' : l === 'alternativa' ? 'alternativa' : 'sconsigliato')
  const pct = $derived(job.bytesTotal ? Math.min(100, (job.bytesDone ?? 0) / job.bytesTotal * 100) : 0)
  const active = $derived(job.state === 'downloading')
</script>

<SectionHead
  title="Scarica"
  sub="Il catalogo completo, dal migliore al peggiore. Scegli un modello e scaricalo in models/: l'app lo vede al riavvio (o al ricaricamento della pagina). Le sorgenti sono ufficiali."
/>

{#if active}
  <div class="dl-progress" role="status" aria-live="polite">
    <div class="dl-progress-head">
      <strong>Scaricando {job.model}</strong>
      {#if job.current}<span class="dl-file">{job.current.name}</span>{/if}
      <Button variant="ghost" onclick={annulla}>annulla</Button>
    </div>
    <div class="dl-bar"><span style:width={`${pct}%`}></span></div>
    <div class="dl-progress-meta">
      {gb(job.bytesDone ?? 0)} / {gb(job.bytesTotal ?? 0)} GB · {pct.toFixed(0)}%
      {#if job.files}· file {Math.min((job.index ?? 0) + 1, job.files.length)}/{job.files.length}{/if}
    </div>
  </div>
{:else if job.state === 'done'}
  <Hintline>Download completato: {job.model}. I modelli sono pronti in models/.</Hintline>
{:else if job.state === 'error'}
  <Hintline err>Download non riuscito: {job.error}</Hintline>
{:else if job.state === 'cancelled'}
  <Hintline>Download annullato.</Hintline>
{/if}

{#if err}
  <Hintline err>{err}</Hintline>
{/if}

{#if loading}
  <Hintline>lettura del catalogo…</Hintline>
{:else if cat}
  {#each cat.groups as g (g.id)}
    <section class="dl-group" aria-label={g.label}>
      <h3 class="dl-group-title">{g.label} <span class="dl-sub">{g.hint}</span></h3>
      <div class="dl-scroll">
        <table class="dl-table">
          <thead>
            <tr>
              <th>Modello</th>
              <th>Peso</th>
              <th>Requisiti</th>
              <th>Sorgente</th>
              <th>Stato</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each g.models as m (m.id)}
              <tr class:is-active={job.modelId === m.id && active}>
                <td class="dl-model">
                  <div class="dl-model-head">
                    <span class="dl-name">{m.name}</span>
                    <span class={labelCls(m.label)}>{labelText(m.label)}</span>
                  </div>
                  <div class="dl-role">{m.quality} · {m.speed} · {m.role}</div>
                </td>
                <td class="dl-size">~{gb(m.sizeBytes)} GB</td>
                <td class="dl-req">{m.requires}</td>
                <td class="dl-src">
                  {#each m.sources as s, i (s.label)}
                    {#if i > 0}<br />{/if}
                    {#if s.url}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>{:else}{s.label}{/if}
                  {/each}
                </td>
                <td class="dl-state">
                  {#if m.installed}
                    <Stamp ok>installato</Stamp>
                  {:else if job.modelId === m.id && active}
                    <span class="dl-live">scaricando…</span>
                  {:else}
                    <span class="dl-missing">mancante</span>
                  {/if}
                </td>
                <td class="dl-action">
                  {#if m.installed}
                    <span class="dl-done">✓</span>
                  {:else}
                    <Button
                      variant="side"
                      onclick={() => download(m)}
                      disabled={active || starting !== null}
                    >{starting === m.id ? '…' : 'scarica'}</Button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/each}

  <p class="dl-note">
    Hardware di riferimento: {cat.hardware}. I pesi non ridistribuibili (Bonsai immagine, DiT Z-Image)
    si copiano da <code>reference/</code>. Ogni file scaricato è verificato con SHA-256 quando disponibile.
  </p>
{/if}
