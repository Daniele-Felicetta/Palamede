<script lang="ts">
  import { onMount } from 'svelte'
  import {
    deleteKbFile, getKbEmbeddings, getKbFiles, getKbStatus,
    ingestKbSource, readKbFile, saveKbFile, searchKb,
  } from '../api'
  import type { KbEmbeddings, KbFileInfo, KbStatus } from '../api'
  import { store } from '../store.svelte'
  import Markdown from '../components/Markdown.svelte'
  import { Button, ChatState, EmptyState, Eyebrow, Field, Hintline, Panel, PromptBox, SectionHead, Stamp } from '../components/ui'

  // Zona RAG: knowledge base llm-wiki (pattern Karpathy). Le fonti vivono in
  // knowledge/raw/, il modello le compila in pagine markdown in knowledge/wiki/
  // con index.md e log.md. Qui: aggiungi fonti, compilale, ispeziona la wiki,
  // e (in Chat) attiva il toggle "knowledge" per usarla come contesto.

  let status = $state<KbStatus | null>(null)
  let emb = $state<KbEmbeddings | null>(null)
  let raw = $state<KbFileInfo[]>([])
  let wiki = $state<KbFileInfo[]>([])
  let err = $state('')
  let hint = $state('')

  // form nuova fonte
  let name = $state('')
  let body = $state('')

  // ispezione pagina wiki / index / schema / log
  let view = $state<{ path: string; content: string } | null>(null)
  let ingesting = $state<string | null>(null)

  const refresh = async () => {
    try {
      const [s, r, w, e] = await Promise.all([
        getKbStatus(), getKbFiles('raw'), getKbFiles('wiki'), getKbEmbeddings(),
      ])
      status = s; raw = r.files; wiki = w.files; emb = e
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }
  onMount(() => { refresh() })

  async function addSource(e: { preventDefault(): void }) {
    e.preventDefault()
    const n = name.trim()
    if (!n || !body.trim()) { err = 'serve un nome e del contenuto'; return }
    err = ''; hint = 'salvataggio…'
    try {
      const fname = n.endsWith('.md') || n.endsWith('.txt') ? n : n + '.md'
      await saveKbFile('raw/' + fname, body)
      name = ''; body = ''
      hint = `fonte ${fname} salvata in knowledge/raw/`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }

  async function compile(f: KbFileInfo) {
    err = ''; ingesting = f.name; hint = `compilo ${f.name}… (il modello aggiorna wiki/, index.md e log.md)`
    try {
      const out = await ingestKbSource(f.name)
      hint = `fatto: ${out.written.length} file scritti (${out.written.join(', ')})`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    } finally {
      ingesting = null
    }
  }

  async function remove(f: KbFileInfo) {
    err = ''
    try {
      await deleteKbFile('raw/' + f.name)
      hint = `fonte ${f.name} eliminata`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }

  async function open(path: string) {
    err = ''
    try { view = await readKbFile(path) } catch (er) { err = er instanceof Error ? er.message : String(er) }
  }

  let q = $state('')
  let hits = $state<string[] | null>(null)
  async function doSearch(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!q.trim()) { hits = null; return }
    err = ''
    try {
      const r = await searchKb(q)
      hits = r.pages
      if (!r.pages.length) hint = 'nessuna pagina wiki rilevante — prova a compilare prima le fonti'
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }

  // Stato del modello chat dallo store condiviso (pollato ogni 3 s): quello di
  // KbStatus è letto solo al mount e resterebbe "spento" se avvii la chat dopo.
  let chatReady = $derived(store.chat?.ready)
</script>

  <header class="rag-head">
    <div>
      <Eyebrow>Sezione RAG · knowledge base</Eyebrow>
      <h1>Fonti grezze, <em>wiki compilata</em>.</h1>
    </div>
    <div class="rag-status-strip">
      <ChatState state={chatReady ? 'on' : 'off'}>
        modello chat {chatReady ? 'pronto' : 'spento'}
      </ChatState>
      <Stamp>{status?.raw ?? 0} fonti</Stamp>
      <Stamp>{status?.wiki ?? 0} pagine wiki</Stamp>
      <Stamp ok={!!emb?.available} title="Ollama /api/embed: embeddinggemma è già installato">
        embeddings {emb?.available ? `${emb.models.length} su Ollama` : 'off (keyword search)'}
      </Stamp>
    </div>
  </header>

  <p class="sec-sub">
    Pattern <em>LLM Wiki</em> (Karpathy): le fonti grezze entrano in <code>knowledge/raw/</code>,
    il modello le <strong>compila</strong> in pagine markdown interconnesse in 
    <code>knowledge/wiki/</code> con indice e registro — niente embeddings a questa scala.
    In <a href="#/chat">Chat</a> attiva <em>knowledge on</em> per usare la wiki come contesto.
  </p>

  <div class="rag-cols">
    <Panel cls="rag-col">
      <SectionHead eyebrow="Fonti" title="Aggiungi una fonte">
        {#snippet sub()}Incolla testo, articolo o nota: finisce in <code>knowledge/raw/</code>.{/snippet}
      </SectionHead>
      <form onsubmit={addSource} class="rag-form">
        <Field label="Nome file" for="srcname">
          <input id="srcname" bind:value={name}
            placeholder="es. nota-flusso-unity.md" />
        </Field>
        <PromptBox
          cls="rag-body"
          bind:value={body}
          placeholder="Contenuto della fonte…"
          ariaLabel="Contenuto della fonte"
        />
        <Button type="submit" disabled={!name.trim() || !body.trim()}>salva fonte</Button>
      </form>

      <div class="rag-list">
        {#if raw.length === 0}
          <EmptyState>Nessuna fonte. Aggiungi la prima qui sopra.</EmptyState>
        {:else}
          {#each raw as f (f.name)}
            <div class="rag-row">
              <button type="button" class="rag-name" onclick={() => open('raw/' + f.name)} title="leggi">
                {f.name}
                <span class="rag-meta">{(f.bytes / 1024).toFixed(1)} KB</span>
              </button>
              <div class="rag-actions">
                <Button variant="ghost" disabled={!!ingesting || !chatReady}
                  onclick={() => compile(f)} title={chatReady ? 'compila nella wiki (modello)' : 'avvia la chat prima'}>
                  {ingesting === f.name ? 'compilo…' : 'compila'}
                </Button>
                <Button variant="side" onclick={() => remove(f)}>elimina</Button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
      {#if !chatReady}
        <Hintline>Il modello chat è spento: avvia la chat per compilare le fonti.</Hintline>
      {/if}
    </Panel>

    <Panel cls="rag-col">
      <SectionHead eyebrow="Wiki compilata" title="Pagine in knowledge/wiki/">
        {#snippet sub()}Le scrive il modello durante la compilazione. Clicca per leggerle.{/snippet}
      </SectionHead>
      <div class="rag-list">
        {#if wiki.length === 0}
          <EmptyState>Wiki vuota: compila una fonte per generare le prime pagine.</EmptyState>
        {:else}
          {#each wiki as f (f.name)}
            <button type="button" class="rag-name" onclick={() => open('wiki/' + f.name)} title="leggi">
              {f.name}
              <span class="rag-meta">{(f.bytes / 1024).toFixed(1)} KB</span>
            </button>
          {/each}
        {/if}
      </div>

      <form onsubmit={doSearch} class="rag-search">
        <input bind:value={q}
          placeholder="Cerca nelle pagine wiki (keyword)…" aria-label="Cerca nella wiki" />
        <Button variant="ghost" type="submit">cerca</Button>
      </form>
      {#if hits}
        <div class="rag-hits">
          {#if hits.length === 0}
            <Hintline>nessuna pagina rilevante</Hintline>
          {:else}
            {#each hits as p (p)}
              <button type="button" class="rag-name" onclick={() => open('wiki/' + p)}>
                {p} <span class="rag-meta">rilevante</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}

      <div class="rag-mini">
        <Button variant="side" onclick={() => open('index.md')}>index.md</Button>
        <Button variant="side" onclick={() => open('log.md')}>log.md</Button>
        <Button variant="side" onclick={() => open('SCHEMA.md')}>SCHEMA.md</Button>
      </div>
    </Panel>
  </div>

  {#if view}
    <Panel cls="rag-view">
      <div class="rag-view-head">
        <Eyebrow>knowledge/{view.path}</Eyebrow>
        <Button variant="side" onclick={() => view = null}>chiudi</Button>
      </div>
      <div class="wiki-body">
        {#if view.path.endsWith('.md')}<Markdown text={view.content} />{:else}<pre>{view.content}</pre>{/if}
      </div>
    </Panel>
  {/if}

  <Hintline err={!!err}>{err || hint}</Hintline>
