<script lang="ts">
  import Markdown from '../components/Markdown.svelte'
  import { getDoc } from '../api'
  import { Eyebrow, Tabs } from '../components/ui'

  // Pagina Progetto: la documentazione dell'officina (mappa, README, SPEC)
  // servita dal hub e resa col mini-renderer markdown del progetto.
  const DOCS = [
    { id: 'mappa', label: 'Mappa', file: 'MAPPA.md' },
    { id: 'readme', label: 'README', file: 'README.md' },
    { id: 'spec', label: 'SPEC', file: 'SPEC.md' },
    { id: 'security', label: 'Sicurezza', file: 'SECURITY.md' },
  ] as const

  type DocId = (typeof DOCS)[number]['id']

  let doc = $state<DocId>('mappa')
  let text = $state<string | null>(null)
  let err = $state('')

  $effect(() => {
    let alive = true
    text = null
    err = ''
    getDoc(doc)
      .then((r) => { if (alive) text = r.text })
      .catch((e) => { if (alive) err = String(e?.message ?? e) })
    return () => { alive = false }
  })
</script>

<Eyebrow>Progetto · documentazione</Eyebrow>
<h1>Il progetto</h1>
<p class="lede">Mappa di struttura, README operativo e specifica tecnica: tutta la documentazione dell'officina, qui dentro.</p>

<Tabs
  items={DOCS.map((d) => ({ id: d.id, label: d.label }))}
  active={doc}
  onselect={(id) => (doc = id as DocId)}
/>

<section class="wiki" style="margin-top: 18px">
  <article class="wiki-entry">
    {#if err}<p class="wiki-body">Errore nel caricamento: {err}</p>{:else if text === null}<p class="wiki-body" style="color: var(--paper-dim)">Caricamento…</p>{:else}<div class="wiki-body"><Markdown text={text} /></div>{/if}
  </article>
</section>
