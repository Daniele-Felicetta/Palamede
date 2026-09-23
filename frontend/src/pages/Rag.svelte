<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getKbStatus, deleteKbFile, uploadKbSource,
    ingestKbSource, retrieveKb, getKbEmbeddings,
  } from '../api'
  import type { KbChunkHit, KbRetrieveResult, KbSourceInfo, KbStatus } from '../api'
  import { store } from '../store.svelte'
  import { Text } from '../lib/text'
  import { buildGroundingSystem, extractCites, citedChunks } from '../lib/rag'
  import Markdown from '../components/Markdown.svelte'
  import ReasonBlock from '../components/ReasonBlock.svelte'
  import SourceCards from '../components/SourceCards.svelte'
  import SourceView from '../components/SourceView.svelte'
  import { Button, ChatState, EmptyState, Eyebrow, Field, Hintline, Panel, PromptBox, SectionHead, Stamp } from '../components/ui'

  // Zona RAG in stile NotebookLM: fonti in knowledge/raw/, indicizzate in
  // chunk+embedding (Ollama embeddinggemma) e interrogate con retrieval ibrido
  // + rerank MiniCPM. La chat qui sotto risponde SOLO dalle fonti, citando [n].

  let status = $state<KbStatus | null>(null)
  let sources = $state<KbSourceInfo[]>([])
  let emb = $state<{ available: boolean; models: string[] }>({ available: false, models: [] })
  let err = $state('')
  let hint = $state('')

  // form nuova fonte (paste)
  let name = $state('')
  let body = $state('')
  let ingesting = $state<string | null>(null)

  // pannello destro: fonte aperta con chunk evidenziato
  let view = $state<{ name: string; path: string; start?: number; end?: number } | null>(null)

  // chat grounded
  let q = $state('')
  let sending = $state(false)
  let answer = $state<{
    text: string
    reason: string
    retr: KbRetrieveResult | null
    cites: number[]
    streaming: boolean
  } | null>(null)

  const refresh = async () => {
    try {
      const [s, e] = await Promise.all([
        getKbStatus(), getKbEmbeddings(),
      ])
      status = s; sources = s.sources; emb = e
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }
  onMount(() => {
    refresh()
    // click delegato sulle citazioni [n] dentro le risposte (markdown escapes
    // le citazioni come <button class="rag-cite" data-cite="n">)
    const h = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      const c = el.closest('.rag-cite') as HTMLElement | null
      if (c?.dataset.cite) openCite(Number(c.dataset.cite))
    }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  })

  // Stato del modello chat dallo store condiviso (polled ogni 3 s).
  let chatReady = $derived(!!store.chat?.ready)

  async function addSource(e: { preventDefault(): void }) {
    e.preventDefault()
    const n = name.trim()
    if (!n || !body.trim()) { err = 'serve un nome e del contenuto'; return }
    err = ''; hint = 'salvataggio + indicizzazione…'
    try {
      const fname = n.endsWith('.md') || n.endsWith('.txt') ? n : n + '.md'
      const r = await uploadKbSource(fname, body)
      name = ''; body = ''
      hint = `fonte ${fname} salvata: ${r.chunks} chunk${r.embedded ? '' : ' (keyword fallback: Ollama spento)'}`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }

  async function onFile(f: File) {
    const n = f.name
    if (!/\.(md|txt)$/i.test(n)) { err = 'solo file .md o .txt'; return }
    err = ''; hint = `indicizzo ${n}…`
    try {
      const content = await f.text()
      const r = await uploadKbSource(n, content)
      hint = `fonte ${n} salvata: ${r.chunks} chunk${r.embedded ? '' : ' (keyword fallback: Ollama spento)'}`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }

  async function reindex(f: KbSourceInfo) {
    err = ''; ingesting = f.name; hint = `re-indicizzo ${f.name}…`
    try {
      const r = await ingestKbSource(f.name)
      hint = `${f.name}: ${r.chunks} chunk${r.embedded ? '' : ' (keyword fallback)'}`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    } finally {
      ingesting = null
    }
  }

  async function remove(f: KbSourceInfo) {
    err = ''
    try {
      await deleteKbFile('raw/' + f.name)
      if (view?.name === f.name) view = null
      hint = `fonte ${f.name} eliminata (chunk rimossi dall'indice)`
      await refresh()
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
    }
  }

  async function openRaw(name: string) {
    err = ''
    try { view = { name, path: 'raw/' + name } } catch (er) { err = er instanceof Error ? er.message : String(er) }
  }

  // ── chat grounded ────────────────────────────────────────────────────────
  async function ask(e: { preventDefault(): void }) {
    e.preventDefault()
    const text = q.trim()
    if (!text || sending || !chatReady) return
    q = ''
    err = ''
    sending = true
    answer = { text: '', reason: '', retr: null, cites: [], streaming: true }
    const a = answer
    try {
      const retr = await retrieveKb(text, 5)
      if (!retr.chunks.length) {
        a.text = 'non è nei tuoi documenti'
        a.streaming = false
        return
      }
      a.retr = retr
      const system = buildGroundingSystem(retr)
      const stream = await groundedStream(text, system)
      Text.stream(
        stream,
        (type, t) => {
          if (type === 'reason') a.reason += t
          else a.text += t
        },
        () => { a.streaming = false; a.cites = extractCites(a.text) },
        (er: Error) => { err = er.message; a.streaming = false },
      )
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
      a.streaming = false
    } finally {
      sending = false
    }
  }

  // Chiamata non-streaming al proxy chat con system prompt grounded: il server
  // (llama-server attivo dalla pagina Chat) risponde streamando i token.
  async function groundedStream(text: string, system: string) {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: text }],
        stream: true,
        temperature: 0.3,
        max_tokens: 900,
        ...(system ? { system } : {}),
      }),
    })
    if (!r.ok || !r.body) throw new Error(`chat HTTP ${r.status}`)
    return r.body
  }

  function openCite(n: number) {
    const chunk = answer?.retr?.chunks[n - 1]
    if (!chunk) return
    view = { name: chunk.source, path: 'raw/' + chunk.source, start: chunk.start, end: chunk.end }
  }

  function openCited(chunk: KbChunkHit) {
    view = { name: chunk.source, path: 'raw/' + chunk.source, start: chunk.start, end: chunk.end }
  }
</script>

  <header class="rag-head">
    <div>
      <Eyebrow>Sezione RAG · knowledge base</Eyebrow>
      <h1>Le tue fonti, <em>interrogate</em>.</h1>
    </div>
    <div class="rag-status-strip">
      <ChatState state={chatReady ? 'on' : 'off'}>
        chat {chatReady ? 'pronta' : 'spenta'}
      </ChatState>
      <Stamp>{status?.raw ?? 0} fonti</Stamp>
      <Stamp>{status?.chunks ?? 0} chunk</Stamp>
      <Stamp ok={!!emb.available} title="Ollama /api/embed: embeddinggemma">
        embeddings {emb.available ? 'on' : 'off'}
      </Stamp>
      <Stamp ok={!!status?.rerank?.ready} title="MiniCPM 2B :8123, start lazy + idle timeout">
        rerank {status?.rerank?.ready ? 'pronto' : status?.rerank?.running ? 'in caricamento' : 'idle'}
      </Stamp>
    </div>
  </header>

  <p class="sec-sub">
    RAG in stile <em>NotebookLM</em>: le fonti entrano in <code>knowledge/raw/</code>, vengono
    spezzate in chunk ed embedded localmente (Ollama <code>embeddinggemma</code>), poi ogni
    domanda recupera i frammenti rilevanti (coseno + keyword, rerank MiniCPM 2B) e il
    modello risponde <strong>solo da quelli</strong>, citando <code>[n]</code>.
  </p>

  <div class="rag-grid">
    <!-- ── pannello sinistro: fonti ─────────────────────────────────── -->
    <Panel cls="rag-panel rag-sources">
      <SectionHead eyebrow="Fonti" title="Le tue fonti">
        {#snippet sub()}Incolla testo o carica un file <code>.md/.txt</code>: viene indicizzato subito.{/snippet}
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
        <div class="rag-form-row">
          <Button type="submit" disabled={!name.trim() || !body.trim()}>aggiungi fonte</Button>
          <label class="rag-upload" title="carica file .md/.txt (drag&drop o click)">
            <input
              type="file" accept=".md,.txt" class="rag-upload-input"
              onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) onFile(f); (e.currentTarget as HTMLInputElement).value = '' }}
            />
            carica file
          </label>
        </div>
      </form>

      <div class="rag-list">
        {#if sources.length === 0}
          <EmptyState>Nessuna fonte. Aggiungine una qui sopra.</EmptyState>
        {:else}
          {#each sources as f (f.name)}
            <div class="rag-row">
              <button type="button" class="rag-name" onclick={() => openRaw(f.name)} title="leggi la fonte">
                {f.name}
                <span class="rag-meta">{f.chunks} chunk{f.embedded ? '' : ' · da embeddare'}</span>
              </button>
              <div class="rag-actions">
                <Button variant="ghost" disabled={!!ingesting}
                  onclick={() => reindex(f)} title="re-indicizza (ri-chunk + ri-embed)">
                  {ingesting === f.name ? 'indicizzo…' : 'ri-embed'}
                </Button>
                <Button variant="side" onclick={() => remove(f)}>elimina</Button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </Panel>

    <!-- ── centro: chat con le fonti ────────────────────────────────── -->
    <Panel cls="rag-panel rag-chat">
      <SectionHead eyebrow="Domanda" title="Chatta con le tue fonti">
        {#snippet sub()}La risposta cita i frammenti recuperati: clicca una citazione per vederla evidenziata nella fonte.{/snippet}
      </SectionHead>

      {#if !chatReady}
        <Hintline>Il modello chat è spento: avvialo dalla pagina <a href="#/chat">Chat</a> per fare domande.</Hintline>
      {:else}
        <form onsubmit={ask} class="rag-search">
          <input bind:value={q}
            placeholder="Chiedi qualcosa basato sulle tue fonti…" aria-label="Domanda sulle fonti" />
          <Button variant="ghost" type="submit" disabled={sending || !q.trim()}>
            {sending ? 'recupero…' : 'chiedi'}
          </Button>
        </form>
      {/if}

      {#if answer}
        <div class="rag-answer" role="status">
          {#if answer.reason}<ReasonBlock text={answer.reason} streaming={answer.streaming} />{/if}
          <div class="rag-answer-text">
            <Markdown text={answer.text} cites={answer.cites.length > 0} />
            {#if answer.streaming}<span class="caret" aria-hidden="true"></span>{/if}
          </div>
          {#if answer.retr && !answer.streaming && answer.cites.length > 0}
            <SourceCards items={citedChunks(answer.retr, answer.text)} onopen={openCited} />
          {/if}
          {#if answer.retr}
            <p class="rag-meta-notes">
              {answer.retr.chunks.length} frammenti recuperati
              {answer.retr.reranked ? ' · rerank MiniCPM' : ' · ranking ibrido'}
            </p>
          {/if}
        </div>
      {:else if chatReady}
        <EmptyState cls="rag-chat-empty">
          Nessuna domanda ancora. Scrivi sopra per interrogare le tue fonti.
        </EmptyState>
      {/if}
    </Panel>

    <!-- ── destro: fonte aperta con chunk evidenziato ───────────────── -->
    <Panel cls="rag-panel rag-viewer">
      <div class="rag-viewer-head">
        <SectionHead eyebrow="Fonte" title={view ? view.name : 'Fonte'}>
          {#snippet sub()}{view?.start !== undefined ? 'passaggio citato evidenziato' : 'leggi il documento'}{/snippet}
        </SectionHead>
        {#if view}
          <Button variant="side" onclick={() => view = null}>chiudi</Button>
        {/if}
      </div>
      {#if view}
        <SourceView path={view.path} start={view.start} end={view.end} />
      {:else}
        <EmptyState>Seleziona una fonte o clicca una citazione per vederla qui.</EmptyState>
      {/if}
    </Panel>
  </div>

  <Hintline err={!!err}>{err || hint}</Hintline>