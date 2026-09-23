<script lang="ts">
  import { TRIED, WIP } from '../data/experiments'
  import { Eyebrow, SectionHead } from '../components/ui'
  import { getJevProjects, jevProjectAction, type JevProjects } from '../api'

  // JEV Hub: elenco dei progetti jev con avvio/arresto, servito dal hub di
  // Palamede (che avvia il servizio jev-hub dedicato). Poll leggero per lo stato.
  let hub = $state<JevProjects | null>(null)
  let hubErr = $state('')
  let busy = $state<string | null>(null)

  async function load() {
    try {
      hub = await getJevProjects()
      hubErr = ''
    } catch (e) {
      hubErr = String((e as Error)?.message ?? e)
    }
  }

  $effect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  })

  async function act(id: string, action: 'start' | 'stop') {
    busy = id
    try {
      await jevProjectAction(id, action)
      await load()
    } catch (e) {
      hubErr = String((e as Error)?.message ?? e)
    } finally {
      busy = null
    }
  }
</script>

<Eyebrow>Sezione EXP · registro delle prove</Eyebrow>
<h1>Experimental</h1>
<p class="lede">
  La cronologia delle sperimentazioni: cosa abbiamo provato e perché si è
  fermata, e cosa stiamo provando adesso — con cosa manca da sistemare e i
  rischi che restano.
</p>

<section aria-label="JEV Hub">
  <SectionHead
    title="JEV Hub"
    sub="I progetti sperimentali jev: avviali e aprili da qui. Girano dal loro percorso originale, con i loro ambienti e pesi."
  />
  {#if hubErr}
    <p class="wiki-body">Errore: {hubErr}</p>
  {:else if hub === null}
    <p class="wiki-body" style="color: var(--paper-dim)">Caricamento…</p>
  {:else if !hub.running}
    <p class="wiki-body" style="color: var(--paper-dim)">
      Progetti in <code>{hub.root}</code> — nessun progetto attivo.
    </p>
  {/if}
  {#if hub}
    <div class="exp-list">
      {#each hub.items as p (p.id)}
        <article class="exp-item">
          <span class="exp-state {p.running ? 'wip' : 'sospeso'}">{p.running ? 'attivo' : 'fermo'}</span>
          <div class="exp-body">
            <h4>{p.name}</h4>
            <p>{p.desc}</p>
            <p class="exp-paths">
              <code>:{p.port}</code>
              {#if p.running}<a class="exp-link" href={p.url} target="_blank" rel="noreferrer">apri UI →</a>{/if}
            </p>
            <div class="exp-hub-actions">
              {#if p.running}
                <button class="exp-hub-btn" disabled={busy === p.id} onclick={() => act(p.id, 'stop')}>Ferma</button>
              {:else}
                <button class="exp-hub-btn" disabled={busy === p.id} onclick={() => act(p.id, 'start')}>Avvia</button>
              {/if}
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<section aria-label="Provato e perché non è andata">
  <SectionHead
    title="Provato e perché non è andata"
    sub="Ordine cronologico. Ogni voce dice cosa era, perché si è fermata e dove sta la prova nel repo."
  />
  <div class="exp-list">
    {#each TRIED as e (e.id)}
      <article class="exp-item">
        <span class="exp-date">{e.period}</span>
        <span class="exp-state {e.status}">{e.status}</span>
        <div class="exp-body">
          <h4>{e.title}</h4>
          <p>{e.what}</p>
          <p class="exp-why"><strong>Perché si è fermata:</strong> {e.why}</p>
          {#if e.paths.length}
            <p class="exp-paths">
              {#each e.paths as p (p)}<code>{p}</code>{/each}
            </p>
          {/if}
        </div>
      </article>
    {/each}
  </div>
</section>

<section aria-label="In prova adesso">
  <SectionHead
    title="In prova adesso"
    sub="Cosa stiamo provando, cosa manca da sistemare e perché potrebbe non funzionare."
  />
  <div class="exp-list">
    {#each WIP as e (e.id)}
      <article class="exp-item">
        <span class="exp-date">{e.period}</span>
        <span class="exp-state wip">in corso</span>
        <div class="exp-body">
          <h4>{e.title}</h4>
          <p>{e.what}</p>
          <div class="exp-fixes">
            <h5>Cosa c'è da sistemare</h5>
            <ul>
              {#each e.fixes as f (f)}<li>{f}</li>{/each}
            </ul>
          </div>
          <div class="exp-risks">
            <h5>Perché potrebbe non andare</h5>
            <ul>
              {#each e.risks as r (r)}<li>{r}</li>{/each}
            </ul>
          </div>
          {#if e.paths.length}
            <p class="exp-paths">
              {#each e.paths as p (p)}<code>{p}</code>{/each}
            </p>
          {/if}
        </div>
      </article>
    {/each}
  </div>
</section>
