<script lang="ts">
  import { onMount } from 'svelte'
  import { chatStream, startChat, stopChat, retrieveKb } from '../api'
  import type { ChatMessage, KbChunkHit, KbRetrieveResult } from '../api'
  import { store } from '../store.svelte'
  import { Text } from '../lib/text'
  import { buildGroundingSystem, extractCites, citedChunks } from '../lib/rag'
  import Markdown from '../components/Markdown.svelte'
  import ReasonBlock from '../components/ReasonBlock.svelte'
  import SourceCards from '../components/SourceCards.svelte'
  import SourceView from '../components/SourceView.svelte'
  import { Button, ChatState, EmptyState, Field, Hintline, Led, Stamp } from '../components/ui'

  interface Msg extends ChatMessage { pending?: boolean; reason?: string; retr?: KbRetrieveResult | null; cites?: number[] }

  // Testo leggibile di un messaggio: i contenuti multimodali (array di parti)
  // si riducono alle sole parti testuali.
  const msgText = (m: Msg): string =>
    typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')

  // Stato del server: arriva dallo store condiviso (un solo poller per la app).
  let status = $derived(store.chat)
  let busy = $state(false)
  let err = $state('')

  let model = $state<Text.ModelId>(Text.DEFAULT_MODEL)
  let settings = $state(Text.defaultsFor(Text.DEFAULT_MODEL))
  let settingsOpen = $state(false)
  let pickerOpen = $state(false)   // selettore modelli aperto/chiuso (compatto di default)

  // knowledge base: se attiva, ogni domanda recupera i frammenti rilevanti
  // (ibrido + rerank) e li inietta come contesto di sistema grounded.
  let kbOn = $state(false)

  let messages = $state<Msg[]>([])
  let input = $state('')
  let sending = $state(false)

  // fonte aperta dal click su una citazione [n] (modale con chunk evidenziato)
  let openSrc = $state<{ name: string; path: string; start?: number; end?: number } | null>(null)

  // click delegato sulle citazioni [n] (markdown le rende come <button class="rag-cite">)
  onMount(() => {
    const h = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      const c = el.closest('.rag-cite') as HTMLElement | null
      if (!c?.dataset.cite) return
      const wrap = el.closest('[data-idx]') as HTMLElement | null
      const m = wrap ? messages[Number(wrap.dataset.idx)] : undefined
      if (m) openCiteFrom(Number(c.dataset.cite), m)
    }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  })

  // contatore tok/s: stima live durante la generazione, preciso a fine stream
  let stats = $state<{ tps: number; tokens: number | null; live: boolean } | null>(null)
  let genStart = 0
  let chars = 0

  // autoscroll "intelligente": segue la generazione solo se l'utente è già in
  // fondo, altrimenti resta dove sta (niente salti mentre legge). Legare
  // l'effetto a contenuto/ragionamento dell'ultimo messaggio (non solo alla
  // lunghezza dell'array) è ciò che fa seguire la generazione token per token.
  let logEl: HTMLDivElement | undefined = $state()
  let stick = true

  $effect(() => {
    const last = messages[messages.length - 1]
    void messages.length
    void last?.content
    void last?.reason
    if (logEl && stick) logEl.scrollTop = logEl.scrollHeight
  })

  function onLogScroll() {
    const el = logEl
    if (!el) return
    stick = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }

  const apply = async () => {
    busy = true; err = ''
    try {
      messages = []
      store.chat = await startChat({ model, ...settings })
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  const stop = async () => {
    busy = true; err = ''
    try { store.chat = await stopChat() } catch (e) { err = String(e) } finally { busy = false }
  }

  // Retrieval knowledge base: se "knowledge on", prima di ogni domanda recupera
  // i frammenti rilevanti. Null → chat liscia (o knowledge off).
  const kbRetrieval = async (text: string): Promise<KbRetrieveResult | null> => {
    if (!kbOn) return null
    try { return await retrieveKb(text, 5) } catch { return null }
  }

  async function send(e: { preventDefault(): void }) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending || !status?.ready) return
    input = ''
    err = ''
    const retr = await kbRetrieval(text)
    const system = retr ? buildGroundingSystem(retr) : undefined
    const history: ChatMessage[] = [
      ...messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    messages = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '', pending: true, retr }]
    sending = true
    stats = null
    genStart = performance.now()
    chars = 0
    stick = true
    try {
      const stream = await chatStream(history, settings.temperature, system)
      Text.stream(
        stream,
        (type, t) => {
          chars += t.length
          const el = (performance.now() - genStart) / 1000
          if (el > 0.4) stats = { tps: (chars / 4) / el, tokens: null, live: true }
          const last = messages[messages.length - 1]
          if (last?.pending) {
            if (type === 'reason') last.reason = (last.reason ?? '') + t
            else last.content += t
          }
        },
        (st) => { if (st) stats = { tps: st.tps, tokens: st.tokens, live: false }; for (const m of messages) if (m.pending) { m.pending = false; m.cites = extractCites(m.content as string) } },
        (er) => { err = er.message; for (const m of messages) if (m.pending) m.pending = false },
      )
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
      messages = messages.filter((m) => !m.pending)
    } finally {
      sending = false
    }
  }

  // Cambio modello esplicito: il click carica il modello scelto sulla GPU
  // (riavviando se il server è già attivo con un altro modello). Il modello
  // attivo non fa nulla. Ogni cambio riparte dai parametri di fabbrica
  // (context/KV/temp) di QUEL modello.
  const pickChatModel = async (id: Text.ModelId) => {
    if (busy) return
    model = id
    pickerOpen = false
    if (status?.running && status?.model === id) return
    settings = Text.defaultsFor(id)
    const cpuMoe = Text.supportsCpuMoe(id) ? settings.cpuMoe : 0
    err = ''
    busy = true
    try {
      messages = []
      store.chat = await startChat({ model: id, ...settings, cpuMoe })
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  function openCiteFrom(n: number, m: Msg) {
    const chunk = m.retr?.chunks[n - 1]
    if (!chunk) return
    openSrc = { name: chunk.source, path: 'raw/' + chunk.source, start: chunk.start, end: chunk.end }
  }

  function openCited(chunk: KbChunkHit) {
    openSrc = { name: chunk.source, path: 'raw/' + chunk.source, start: chunk.start, end: chunk.end }
  }

  // focus il modale all'apertura (per chiudere con Escape via tastiera)
  function focusModal(node: HTMLElement) {
    node.focus()
    return {}
  }

  let loaded = $derived(Text.get(status?.model ?? '') ?? Text.get(model))
  let stateOf = (id: string) => {
    const active = status?.running && status?.model === id
    return active ? (status.ready ? 'on' : 'busy') : (model === id ? 'sel' : 'off')
  }
</script>

<header class="chat-head">
  <div class="chat-head-inner">
    <div class="chat-head-row">
      <h1 class="chat-title">Ornith, <em>in casa</em>.</h1>
      <div class="chat-head-actions">
        <ChatState state={status?.ready ? 'on' : 'off'}>
          {status?.running ? (status.ready ? 'pronto' : 'in caricamento…') : 'spento'}
        </ChatState>
        {#if status?.running}
          <Button variant="ghost" onclick={stop} disabled={busy}>ferma</Button>
        {:else}
          <Button onclick={apply} disabled={busy}>{busy ? 'avvio…' : 'avvia'}</Button>
        {/if}
        <Button variant="side" cls="chat-tool" toggled={kbOn} onclick={() => kbOn = !kbOn} aria-pressed={kbOn}
          title="Usa la knowledge base (knowledge/) come contesto per ogni domanda">
          {kbOn ? 'knowledge on' : 'knowledge off'}
        </Button>
        <Button variant="side" cls="chat-tool" toggled={settingsOpen} onclick={() => settingsOpen = !settingsOpen} aria-expanded={settingsOpen}>
          impostazioni
        </Button>
      </div>
    </div>

    <button class="model-bar" type="button" onclick={() => (pickerOpen = !pickerOpen)} aria-expanded={pickerOpen} aria-label="Scegli modello">
      <span class="model-bar-name">
        <Led state={status?.ready ? 'on' : status?.running ? 'busy' : 'off'} />
        {loaded?.name ?? model}
      </span>
      <span class="model-bar-tags">
        {#if loaded}<Stamp>{loaded.family}</Stamp><Stamp hot={!status?.ready}>{Text.modelStamp(loaded.id)}</Stamp>{/if}
      </span>
      <svg class={`model-bar-caret${pickerOpen ? ' up' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    {#if pickerOpen}
      <div class="chat-picker" role="radiogroup" aria-label="Modello chat">
        {#each Text.MODELS as m (m.id)}
          {@const active = status?.running && status?.model === m.id}
          {@const loading = active && !status?.ready}
          {@const st = stateOf(m.id)}
          <button
            type="button"
            role="radio"
            aria-checked={model === m.id}
            class={`pick${st === 'on' ? ' on' : st === 'sel' ? ' sel' : ''}`}
            disabled={busy || loading}
            title={active
              ? (loading ? 'in caricamento…' : `modello attivo: ${m.name}. "ferma" lo scarica dalla GPU`)
              : `carica ${m.name} sulla GPU`}
            onclick={() => pickChatModel(m.id)}
          >
            <span class="pick-name"><Led state={st === 'on' ? 'on' : st === 'busy' ? 'busy' : st === 'sel' ? 'busy' : 'off'} />{m.name}</span>
            <span class="pick-tags"><Stamp>{m.family}</Stamp><Stamp hot={!active}>{Text.modelStamp(m.id)}</Stamp></span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</header>

{#if settingsOpen}
  <div class="chat-settings">
    <div class="chat-settings-inner">
      <div class="field-row">
        <Field label="Contesto" for="ctx">
          <input id="ctx" type="number" min={1024} max={65536} step={1024}
            value={settings.context}
            oninput={(e) => settings.context = Number(e.currentTarget.value) || 8192} />
        </Field>
        <Field label="KV cache" for="kv">
          <select id="kv" bind:value={settings.kv}>
            {#each Text.KV_OPTIONS as [v, lab] (v)}<option value={v}>{lab}</option>{/each}
          </select>
        </Field>
        <Field label="Temperatura" for="temp">
          <input id="temp" type="number" min={0} max={2} step={0.1}
            value={settings.temperature}
            oninput={(e) => settings.temperature = Number(e.currentTarget.value) || 0} />
        </Field>
        <Field label="Layer GPU" for="ngl">
          <input id="ngl" type="number" min={-1} max={200}
            value={settings.gpuLayers}
            oninput={(e) => settings.gpuLayers = Number(e.currentTarget.value) || 99} />
        </Field>
        {#if Text.vramProfilesFor(model).length > 0}
          <Field label="Profilo VRAM" for="vram">
            <select id="vram"
              value={Text.vramProfilesFor(model).find(p => p.cpuMoe === settings.cpuMoe && p.movaCpu === settings.movaCpu)?.id ?? 'custom'}
              onchange={(e) => {
                const p = Text.vramProfilesFor(model).find(x => x.id === e.currentTarget.value)
                if (p) { settings.cpuMoe = p.cpuMoe; settings.movaCpu = p.movaCpu }
              }}
              title="Imposta insieme gli esperti MoE su CPU e il banco MoVA dell'attenzione">
              <option value="custom">personalizzato</option>
              {#each Text.vramProfilesFor(model) as p (p.id)}
                <option value={p.id}>{p.label} · {p.hint}</option>
              {/each}
            </select>
          </Field>
        {/if}
        {#if Text.isMoe(model)}
          <Field label="Layer MoE su CPU" for="cmoe">
            <input id="cmoe" type="number" min={0} max={64}
              value={settings.cpuMoe}
              oninput={(e) => settings.cpuMoe = Math.max(0, Number(e.currentTarget.value) || 0)}
              title="Sposta i pesi degli esperti MoE dei primi N layer sulla CPU (libera VRAM)" />
          </Field>
        {/if}
        {#if Text.supportsMova(model)}
          <Field check>
            <input type="checkbox" bind:checked={settings.movaCpu} />
            <span title="Sposta il banco di esperti dell'attenzione MoVA (attn_v_exps) sulla CPU: libera ~3 GB di VRAM, prompt più lento">Attention MoVA su CPU</span>
          </Field>
        {/if}
        <Field check>
          <input type="checkbox" bind:checked={settings.mtp} />
          <span>MTP (multi-token prediction)</span>
        </Field>
        <Field check>
          <input type="checkbox" bind:checked={settings.thinking} />
          <span>Thinking (ragionamento interno)</span>
        </Field>
      </div>
      {#if Text.isMoe(model) && settings.cpuMoe > 0}
        <p class="chat-note">I pesi degli esperti dei primi {settings.cpuMoe} layer andranno su CPU: meno VRAM, più lento.</p>
      {/if}
      {#if Text.supportsMova(model) && settings.movaCpu}
        <p class="chat-note">Il banco dell'attenzione MoVA (attn_v_exps) andrà su CPU: libera ~3 GB di VRAM, prompt più lento.</p>
      {/if}
      {#if Text.vramProfilesFor(model).some(p => p.id === 'max-speed' && p.cpuMoe === settings.cpuMoe && p.movaCpu === settings.movaCpu)}
        <p class="chat-note">Profilo a piena velocità: serve ~13 GB di VRAM solo per il chat — scarica prima il modello immagine (pagina Immagini), altrimenti non parte.</p>
      {/if}
      <Hintline>{status?.running
        ? Text.statusLine(status)
        : 'Scegli un modello qui sopra e premi "avvia" (o apri il selettore e clicca la sua scheda per caricarlo sulla GPU).'}</Hintline>
    </div>
  </div>
{/if}

<div class="chat-area">
  <div class="chat-col">
    <div class="chat-scroll" bind:this={logEl} onscroll={onLogScroll}>
      <div class="chat-log" aria-live="polite">
        {#if messages.length === 0}
          <EmptyState cls="chat-empty">
            {#if !status?.running}
              <p class="empty-title">Server spento</p>
              <p>Premi <strong>avvia</strong> qui sopra per caricare {loaded?.name ?? model} sulla GPU, poi scrivi qui sotto.</p>
            {:else if !status.ready}
              <p class="empty-title">In caricamento…</p>
              <p>{loaded?.name ?? model} sta entrando in VRAM. Ancora qualche secondo, poi si può scrivere.</p>
            {:else}
              <p class="empty-title">Si comincia</p>
              <p>Scrivi una domanda e premi Invio per parlare con {loaded?.name ?? model}.</p>
              {#if kbOn}<p class="empty-note">knowledge on — risponderà citando le tue fonti.</p>{/if}
            {/if}
          </EmptyState>
        {:else}
          {#each messages as m, i (i)}
            {#if m.role === 'user'}
              <div class="bubble user">{msgText(m)}</div>
            {:else}
              <div class="msg assistant">
                <span class="avatar" aria-hidden="true">O</span>
                <div class="msg-body">
                  {#if m.reason}<ReasonBlock text={m.reason} streaming={!!m.pending} />{/if}
                  <div class="msg-text" data-idx={i}>
                    <Markdown text={msgText(m)} cites={!!m.retr && (m.cites?.length ?? 0) > 0} />
                    {#if m.pending}<span class="caret" aria-hidden="true"></span>{/if}
                  </div>
                  {#if m.retr && !m.pending && (m.cites?.length ?? 0) > 0}
                    <SourceCards items={citedChunks(m.retr, msgText(m))} onopen={openCited} />
                  {/if}
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </div>

    <div class="chat-composer">
      <div class="chat-composer-inner">
        {#if stats}
          <p class={`chat-stats ${stats.live ? 'live' : ''}`} role="status">
            {#if stats.live}
              generazione… <strong>≈{stats.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</strong> tok/s
            {:else}
              <strong>{stats.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</strong> tok/s
              {#if stats.tokens != null} · {stats.tokens} token{/if}
            {/if}
          </p>
        {/if}
        <form class="composer-box" onsubmit={send}>
          <textarea
            class="composer-input"
            bind:value={input}
            onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) } }}
            placeholder={status?.ready
              ? (kbOn ? 'Domanda con le tue fonti… (Invio invia)' : 'Chiedi qualcosa a Ornith… (Invio invia, Shift+Invio a capo)')
              : 'Server spento: premi "avvia" qui sopra.'}
            aria-label="Messaggio"
            rows={2}
            disabled={!status?.ready}
          ></textarea>
          <button class="send-btn" type="submit"
            disabled={sending || !status?.ready || !input.trim()}
            title="Invia" aria-label="Invia">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 8l11-5-3.5 9-2.2-3.6L2 8z" fill="currentColor" />
            </svg>
          </button>
        </form>
        <Hintline err={!!err}>{err}</Hintline>
        {#if kbOn && !err}
          <Hintline cls="kb-note">
            knowledge on — prima di ogni domanda recupero i frammenti rilevanti dalle tue fonti in knowledge/
          </Hintline>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if openSrc}
  <div class="chat-modal" role="dialog" aria-modal="true" aria-label={openSrc.name} tabindex="-1"
    use:focusModal
    onclick={(e) => { if (e.target === e.currentTarget) openSrc = null }}
    onkeydown={(e) => { if (e.key === 'Escape') openSrc = null }}>
    <div class="chat-modal-card">
      <div class="chat-modal-head">
        <span class="chat-modal-title">{openSrc.name}</span>
        <Button variant="side" onclick={() => openSrc = null}>chiudi</Button>
      </div>
      <div class="chat-modal-body">
        <SourceView path={openSrc.path} start={openSrc.start} end={openSrc.end} />
      </div>
    </div>
  </div>
{/if}
