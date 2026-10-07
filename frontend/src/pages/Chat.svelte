<script lang="ts">
  import { onMount } from 'svelte'
  import { chatStream, startChat, stopChat, retrieveKb, listChats, getChat, saveChat, renameChat, deleteChat } from '../api'
  import type { ChatMessage, KbChunkHit, KbRetrieveResult } from '../api'
  import { store } from '../store.svelte'
  import { session } from '../lib/chat-session.svelte'
  import { Text } from '../lib/text'
  import { buildGroundingSystem, extractCites } from '../lib/rag'
  import { msgText, type ViewMsg as Msg } from '../lib/chat-view'
  import { fitTextarea, flatTextarea, focusInput, focusModal } from '../lib/ui-actions'
  import MessageList from '../components/chat/MessageList.svelte'
  import SourceView from '../components/SourceView.svelte'
  import { Button, ChatState, Field, Hintline, KvSquare, Led, Stamp } from '../components/ui'

  // Stato del server: arriva dallo store condiviso (un solo poller per la app).
  let status = $derived(store.chat)

  let settingsOpen = $state(false)
  let pickerOpen = $state(false)

  // knowledge base: se attiva, ogni domanda recupera i frammenti rilevanti
  // (ibrido + rerank) e li inietta come contesto di sistema grounded.

  // ── conversazioni persistite (outputs/chats via hub) ──────────────────
  // Una chat attiva (chatId) + l'elenco salvato (chatList). La chat attiva si
  // salva automaticamente dopo ogni risposta; una nuova chat parte senza id
  // finché il primo scambio non la crea su disco.
  let drawerOpen = $state(false)
  let editing = $state<string | null>(null)   // id in rinomina inline
  let editText = $state('')
  let confirmDel = $state<string | null>(null) // id in attesa di conferma elimina

  // copia risposta (feedback "copiato" temporaneo)
  let copied = $state<number | null>(null)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  async function refreshChats() {
    try { session.chatList = await listChats() } catch { /* hub giù: lista vuota */ }
  }

  async function persist() {
    if (session.messages.length === 0) return
    try {
      const doc = await saveChat({
        id: session.chatId ?? undefined,
        model: status?.model ?? session.model,
        messages: session.messages.map((m) => ({ role: m.role, content: m.content, retr: m.retr ?? null, cites: m.cites ?? [] })),
      })
      session.chatId = doc.id
      await refreshChats()
    } catch (e) { session.err = 'salvataggio conversazione non riuscito: ' + (e instanceof Error ? e.message : String(e)) }
  }

  function newChat() {
    session.genAbort?.abort()
    session.chatId = null
    session.messages = []
    session.input = ''
    session.stats = null
    session.err = ''
    drawerOpen = false
    editing = null
    confirmDel = null
    flatTextarea(taEl)
  }

  async function openChat(id: string) {
    if (session.sending) return
    try {
      const doc = await getChat(id)
      session.chatId = doc.id
      session.messages = doc.messages.map((m) => {
        const retr = (m.retr as KbRetrieveResult | null | undefined) ?? null
        const mm: Msg = { role: m.role, content: m.content, retr }
        mm.cites = m.cites ?? (retr ? extractCites(msgText(mm)) : undefined)
        return mm
      })
      drawerOpen = false
      editing = null
      confirmDel = null
      session.err = ''
      session.stats = null
      stick = true
    } catch (e) { session.err = e instanceof Error ? e.message : String(e) }
  }

  async function removeChat(id: string) {
    try {
      await deleteChat(id)
      if (session.chatId === id) newChat()
      await refreshChats()
    } catch (e) { session.err = e instanceof Error ? e.message : String(e) }
    finally { confirmDel = null }
  }

  function startRename(id: string, cur: string) {
    editing = id
    editText = cur
    confirmDel = null
  }

  async function commitRename() {
    const id = editing
    const title = editText.trim()
    editing = null
    if (!id || !title) return
    try { await renameChat(id, title); await refreshChats() }
    catch (e) { session.err = e instanceof Error ? e.message : String(e) }
  }

  // fonte aperta dal click su una citazione [n] (modale con chunk evidenziato)
  let openSrc = $state<{ name: string; path: string; start?: number; end?: number } | null>(null)

  // click delegato sulle citazioni [n] (markdown le rende come <button class="rag-cite">)
  onMount(() => {
    refreshChats()
    const h = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      const c = el.closest('.rag-cite') as HTMLElement | null
      if (!c?.dataset.cite) return
      const wrap = el.closest('[data-idx]') as HTMLElement | null
      const m = wrap ? session.messages[Number(wrap.dataset.idx)] : undefined
      if (m) openCiteFrom(Number(c.dataset.cite), m)
    }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  })

  // autoscroll "intelligente": segue la generazione solo se l'utente è già in
  // fondo, altrimenti resta dove sta (niente salti mentre legge).
  let logEl: HTMLDivElement | undefined = $state()
  let stick = true

  $effect(() => {
    const last = session.messages[session.messages.length - 1]
    void session.messages.length
    void last?.content
    void last?.reason
    if (logEl && stick) logEl.scrollTop = logEl.scrollHeight
  })

  function onLogScroll() {
    const el = logEl
    if (!el) return
    stick = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }

  // composer che cresce col testo (fino a un tetto), invece di scrollare subito
  let taEl: HTMLTextAreaElement | undefined = $state()
  function autoGrow() {
    fitTextarea(taEl)
  }

  const apply = async () => {
    if (session.sending) return
    session.busy = true; session.err = ''
    try {
      // Nuove impostazioni su server già attivo: riavvia mantenendo la chat a
      // schermo. Da spento (o al primo avvio) si riparte da una chat vuota:
      // azzero anche chatId, altrimenti il prossimo salvataggio sovrascriverebbe
      // la conversazione precedentemente aperta.
      if (!status?.running) { session.messages = []; session.chatId = null }
      const cpuMoe = Text.supportsCpuMoe(session.model) ? session.settings.cpuMoe : 0
      const movaCpu = Text.supportsMova(session.model) ? session.settings.movaCpu : false
      store.chat = await startChat({ model: session.model, ...session.settings, cpuMoe, movaCpu })
    } catch (e) {
      session.err = e instanceof Error ? e.message : String(e)
    } finally {
      session.busy = false
    }
  }

  const stopServer = async () => {
    if (session.sending) return
    session.busy = true; session.err = ''
    try { store.chat = await stopChat() } catch (e) { session.err = String(e) } finally { session.busy = false }
  }

  // Retrieval knowledge base: se "knowledge on", prima di ogni domanda recupera
  // i frammenti rilevanti. Null → chat liscia (o knowledge off).
  const kbRetrieval = async (text: string): Promise<KbRetrieveResult | null> => {
    if (!session.kbOn) return null
    try { return await retrieveKb(text, 5) } catch { return null }
  }

  // Chiusura pulita di uno stream (normale o interrotto): chiude i messaggi
  // pendenti, ne calcola le citazioni e riabilita il composer.
  function finish() {
    for (const m of session.messages) if (m.pending) { m.pending = false; m.cites = extractCites(msgText(m)) }
    session.sending = false
    session.genAbort = null
  }

  function stopGen() {
    session.genAbort?.abort()
  }

  async function send(e: { preventDefault(): void }) {
    e.preventDefault()
    const text = session.input.trim()
    if (!text || session.sending || !status?.ready) return
    session.input = ''
    flatTextarea(taEl)
    session.err = ''
    const retr = await kbRetrieval(text)
    const system = retr ? buildGroundingSystem(retr) : undefined
    const history: ChatMessage[] = [
      ...session.messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    session.messages = [...session.messages, { role: 'user', content: text }, { role: 'assistant', content: '', pending: true, retr }]
    session.sending = true
    session.stats = null
    session.genStart = performance.now()
    session.chars = 0
    stick = true
    session.genAbort = new AbortController()
    let stream: ReadableStream<Uint8Array>
    try {
      stream = await chatStream(history, session.settings.temperature, system, undefined, session.genAbort.signal)
    } catch (er) {
      const aborted = er instanceof Error && er.name === 'AbortError'
      if (aborted) finish()
      else { session.sending = false; session.genAbort = null; session.err = er instanceof Error ? er.message : String(er); session.messages = session.messages.filter((m) => !m.pending) }
      return
    }
    try {
      Text.stream(
        stream,
        (type, t) => {
          session.chars += t.length
          const el = (performance.now() - session.genStart) / 1000
          if (el > 0.4) session.stats = { tps: (session.chars / 4) / el, tokens: null, live: true }
          const last = session.messages[session.messages.length - 1]
          if (last?.pending) {
            if (type === 'reason') last.reason = (last.reason ?? '') + t
            else last.content += t
          }
        },
        (st) => { if (st) session.stats = { tps: st.tps, tokens: st.tokens, live: false }; finish(); persist() },
        (er) => {
          const aborted = !!session.genAbort?.signal.aborted || er?.name === 'AbortError'
          if (aborted) { finish(); persist() }
          else { finish(); session.err = er.message }
        },
      )
    } catch (er) {
      finish()
      session.err = er instanceof Error ? er.message : String(er)
    }
  }

  async function copyMsg(i: number) {
    try {
      await navigator.clipboard.writeText(msgText(session.messages[i]))
      copied = i
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { if (copied === i) copied = null }, 1400)
    } catch { /* clipboard negato */ }
  }

  // Cambio modello esplicito: il click SELEZIONA soltanto (scheda + default di
  // quel modello), senza toccare il server. A caricare ci pensa "avvia".
  // Così si può guardare un modello senza farlo partire per sbaglio.
  const pickChatModel = (id: Text.ModelId) => {
    if (session.busy) return
    session.model = id
    pickerOpen = false
    if (status?.running && status?.model === id) return
    session.settings = Text.defaultsFor(id)
    session.err = ''
  }

  function openCiteFrom(n: number, m: Msg) {
    const chunk = m.retr?.chunks[n - 1]
    if (!chunk) return
    openSrc = { name: chunk.source, path: 'raw/' + chunk.source, start: chunk.start, end: chunk.end }
  }

  function openCited(chunk: KbChunkHit) {
    openSrc = { name: chunk.source, path: 'raw/' + chunk.source, start: chunk.start, end: chunk.end }
  }

  let loaded = $derived(Text.get(status?.model ?? '') ?? Text.get(session.model))
  let stateOf = (id: string) => {
    const active = status?.running && status?.model === id
    return active ? (status.ready ? 'on' : 'busy') : (session.model === id ? 'sel' : 'off')
  }

  // Solo i modelli realmente scaricati: /api/chat/status elenca i file presenti.
  // Se lo stato non è ancora arrivato (hub giù) non si nasconde nulla.
  const availableIds = $derived.by(() => {
    const ms = status?.models
    if (!ms || !ms.length) return null
    return new Set(ms.map((m) => m.id))
  })
  let visibleModels = $derived(Text.MODELS.filter((m) => !availableIds || availableIds.has(m.id)))
  $effect(() => {
    if (!status?.running && availableIds && visibleModels.length && !availableIds.has(session.model)) {
      session.model = visibleModels[0].id
      session.settings = Text.defaultsFor(session.model)
    }
  })

  // Le impostazioni correnti differiscono da quelle in uso dal server attivo?
  let settingsDirty = $derived.by(() => {
    const p = status?.params
    if (!status?.running || !p) return false
    return p.context !== session.settings.context
      || p.kv !== session.settings.kv
      || !!p.mtp !== !!session.settings.mtp
      || p.cpuMoe !== session.settings.cpuMoe
      || !!p.movaCpu !== !!session.settings.movaCpu
      || p.gpuLayers !== session.settings.gpuLayers
      || !!p.thinking !== !!session.settings.thinking
  })

  function closePanels() { drawerOpen = false; settingsOpen = false }
</script>

<header class="chat-head">
  <div class="chat-head-inner">
    <div class="chat-bar">
      <button class="model-chip" type="button" onclick={() => (pickerOpen = !pickerOpen)} aria-expanded={pickerOpen} aria-label="Scegli modello">
        <Led state={status?.ready ? 'on' : status?.running ? 'busy' : 'off'} />
        <span class="model-chip-name">{loaded?.name ?? session.model}</span>
        {#if loaded}<span class="model-chip-tag">{Text.modelStamp(loaded.id)}</span>{/if}
        <svg class={`model-chip-caret${pickerOpen ? ' up' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div class="chat-actions">
        <ChatState state={status?.ready ? 'on' : 'off'}>
          {status?.running ? (status.ready ? 'pronto' : 'carico…') : 'spento'}
        </ChatState>
        {#if status?.running}
          {#if settingsDirty}<Button cls="chat-tool" toggled onclick={apply} disabled={session.busy || session.sending}>{session.busy ? 'riavvio…' : 'applica'}</Button>{/if}
          <Button variant="ghost" onclick={stopServer} disabled={session.busy || session.sending}>ferma</Button>
        {:else}
          <Button onclick={apply} disabled={session.busy}>{session.busy ? 'avvio…' : 'avvia'}</Button>
        {/if}
        <a class="models-dl-btn" href="#/downloader" title="Scarica altri modelli">＋ modelli</a>
        <button class="icon-btn" type="button" onclick={newChat} title="Nuova conversazione" aria-label="Nuova conversazione">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
        <button class="icon-btn" type="button" class:toggled={drawerOpen}
          onclick={() => { drawerOpen = !drawerOpen; settingsOpen = false; pickerOpen = false }}
          title="Conversazioni" aria-label="Conversazioni" aria-expanded={drawerOpen}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
          </svg>
          {#if session.chatList.length}<span class="icon-badge">{session.chatList.length}</span>{/if}
        </button>
        <button class="icon-btn" type="button" class:toggled={session.kbOn} onclick={() => (session.kbOn = !session.kbOn)}
          title="Usa la knowledge base come contesto" aria-label="Knowledge base" aria-pressed={session.kbOn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 3.5h4a2 2 0 0 1 2 2V13a2 2 0 0 0-2-2H3zM13 3.5H9a2 2 0 0 0-2 2V13a2 2 0 0 1 2-2h4z" />
          </svg>
        </button>
        <button class="icon-btn" type="button" class:toggled={settingsOpen}
          onclick={() => { settingsOpen = !settingsOpen; pickerOpen = false }}
          title="Impostazioni" aria-label="Impostazioni" aria-expanded={settingsOpen}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M3 5h10M3 11h10" /><circle cx="6" cy="5" r="1.6" fill="var(--ink)" /><circle cx="10" cy="11" r="1.6" fill="var(--ink)" />
          </svg>
        </button>
      </div>
    </div>

    {#if pickerOpen}
      <div class="chat-picker" role="radiogroup" aria-label="Modello chat">
        {#each visibleModels as m (m.id)}
          {@const active = status?.running && status?.model === m.id}
          {@const loading = active && !status?.ready}
          {@const st = stateOf(m.id)}
          <button
            type="button"
            role="radio"
            aria-checked={session.model === m.id}
            class={`pick${st === 'on' ? ' on' : st === 'sel' ? ' sel' : ''}`}
            disabled={session.busy || loading}
            title={active
              ? (loading ? 'in caricamento…' : `modello attivo: ${m.name}. "ferma" lo scarica dalla GPU`)
              : `seleziona ${m.name} (senza avviarlo: per caricarlo premi "avvia")`}
            onclick={() => pickChatModel(m.id)}
          >
            <span class="pick-name"><Led state={st === 'on' ? 'on' : st === 'busy' ? 'busy' : st === 'sel' ? 'busy' : 'off'} />{m.name}</span>
            <span class="pick-tags"><Stamp>{m.family}</Stamp><Stamp hot={!active}>{Text.modelStamp(m.id)}</Stamp></span>
          </button>
        {/each}
        <a class="models-dl-btn pick-dl" href="#/downloader">＋ scarica altri modelli</a>
      </div>
    {/if}
  </div>
</header>

{#if drawerOpen}
  <div class="chat-backdrop" onclick={closePanels} aria-hidden="true"></div>
  <aside class="chat-panel" aria-label="Conversazioni">
    <div class="chat-panel-head">
      <span class="chat-panel-title">Conversazioni</span>
      <div class="chat-panel-head-actions">
        <Button variant="side" onclick={newChat}>+ nuova</Button>
        <button class="icon-btn" type="button" onclick={closePanels} aria-label="Chiudi">×</button>
      </div>
    </div>
    <div class="chat-panel-body">
      {#if session.chatList.length === 0}
        <p class="chat-panel-empty">Nessuna conversazione salvata. Scrivine una: si salva da sola.</p>
      {:else}
        <ul class="chat-conv-list">
          {#each session.chatList as c (c.id)}
            <li class={`chat-conv${c.id === session.chatId ? ' on' : ''}`}>
              {#if editing === c.id}
                <form class="chat-conv-edit" onsubmit={(e) => { e.preventDefault(); commitRename() }}>
                  <input class="chat-conv-input" bind:value={editText} use:focusInput aria-label="Titolo conversazione"
                    onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); editing = null } }} />
                  <button class="chat-conv-ok" type="submit" aria-label="Salva titolo">✓</button>
                </form>
              {:else}
                <button type="button" class="chat-conv-open" onclick={() => openChat(c.id)} title={c.title} disabled={session.sending}>
                  <span class="chat-conv-name">{c.title}</span>
                  <span class="chat-conv-meta">{c.model ? Text.modelName(c.model) : ''} · {c.n} msg</span>
                </button>
                <div class="chat-conv-tools">
                  <button type="button" class="chat-conv-btn" onclick={() => startRename(c.id, c.title)} title="Rinomina" aria-label="Rinomina conversazione">✎</button>
                  {#if confirmDel === c.id}
                    <button type="button" class="chat-conv-btn del" onclick={() => removeChat(c.id)} title="Conferma eliminazione">elimina</button>
                  {:else}
                    <button type="button" class="chat-conv-btn" onclick={() => { confirmDel = c.id }} title="Elimina" aria-label="Elimina conversazione">×</button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </aside>
{/if}

{#if settingsOpen}
  <div class="chat-backdrop" onclick={closePanels} aria-hidden="true"></div>
  <aside class="chat-panel wide" aria-label="Impostazioni">
      <div class="chat-panel-head">
        <span class="chat-panel-title">Impostazioni · {loaded?.name ?? session.model}</span>
      <button class="icon-btn" type="button" onclick={closePanels} aria-label="Chiudi">×</button>
    </div>
    <div class="chat-panel-body">
      <div class="field-row">
        <Field label="Contesto" for="ctx">
          <input id="ctx" type="number" min={1024} max={524288} step={1024}
            value={session.settings.context}
            oninput={(e) => session.settings.context = Number(e.currentTarget.value) || 8192} />
        </Field>
        <Field label="Temperatura" for="temp">
          <input id="temp" type="number" min={0} max={2} step={0.1}
            value={session.settings.temperature}
            oninput={(e) => session.settings.temperature = Number(e.currentTarget.value) || 0} />
        </Field>
        <Field label="Layer GPU" for="ngl">
          <input id="ngl" type="number" min={-1} max={200}
            value={session.settings.gpuLayers}
            oninput={(e) => session.settings.gpuLayers = Number(e.currentTarget.value) || 99} />
        </Field>
        {#if Text.vramProfilesFor(session.model).length > 0}
          <Field label="Profilo VRAM" for="vram">
            <select id="vram"
              value={Text.activeProfile(session.model, session.settings)?.id ?? 'custom'}
              onchange={(e) => {
                const p = Text.vramProfilesFor(session.model).find(x => x.id === e.currentTarget.value)
                if (!p) return
                session.settings.cpuMoe = p.cpuMoe
                session.settings.movaCpu = p.movaCpu
                if (p.kv) session.settings.kv = p.kv
                if (p.context) session.settings.context = p.context
                // mtp va insieme a cpuMoe -1: senza VRAM libera per l'head il
                // draft attraversa il PCIe e il profilo risulti piu' lento.
                if (p.mtp !== undefined) session.settings.mtp = p.mtp
              }}
              title="Imposta insieme contesto, KV cache, dove stanno gli esperti MoE (e il banco MoVA dell'attenzione) e se attivare lo spec-decode MTP">
              <option value="custom">personalizzato</option>
              {#each Text.vramProfilesFor(session.model) as p (p.id)}
                <option value={p.id}>{p.label} · {p.hint}</option>
              {/each}
            </select>
          </Field>
        {/if}
        {#if Text.isMoe(session.model)}
          <Field label="Layer MoE su CPU" for="cmoe">
            <input id="cmoe" type="number" min={-1} max={64}
              value={session.settings.cpuMoe}
              oninput={(e) => session.settings.cpuMoe = Math.max(-1, Number(e.currentTarget.value) || 0)}
              title="Sposta i pesi degli esperti MoE dei primi N layer sulla CPU (libera VRAM). -1 = tutti gli esperti su CPU" />
          </Field>
        {/if}
        {#if Text.supportsMova(session.model)}
          <Field check>
            <input type="checkbox" bind:checked={session.settings.movaCpu} />
            <span title="Sposta il banco di esperti dell'attenzione MoVA (attn_v_exps) sulla CPU: libera ~3 GB di VRAM, prompt più lento">Attention MoVA su CPU</span>
          </Field>
        {/if}
        <Field check>
          <input type="checkbox" bind:checked={session.settings.mtp} />
          <span>MTP (multi-token prediction)</span>
        </Field>
        <Field check>
          <input type="checkbox" bind:checked={session.settings.thinking} />
          <span>Thinking (ragionamento interno)</span>
        </Field>
      </div>
      <div class="kv-slot">
        <KvSquare value={session.settings.kv} context={session.settings.context} onselect={(v) => (session.settings.kv = v)} />
      </div>
      {#if session.settings.context > 65536}
        <p class="chat-note">Contesto oltre 64k: la KV cache cresce in modo lineare e va in RAM (su 16 GB di VRAM ~4,4 GB a 64k, ~35 GB a 512k). Con un modello immagine caricato il load può fallire: scaricalo prima.</p>
      {/if}
      {#if Text.isMoe(session.model) && session.settings.cpuMoe > 0}
        <p class="chat-note">I pesi degli esperti dei primi {session.settings.cpuMoe} layer andranno su CPU: meno VRAM, più lento.</p>
      {/if}
      {#if Text.supportsMova(session.model) && session.settings.movaCpu}
        <p class="chat-note">Il banco dell'attenzione MoVA (attn_v_exps) andrà su CPU: libera ~3 GB di VRAM, prompt più lento.</p>
      {/if}
      {#if Text.vramProfilesFor(session.model).some(p => p.id === 'max-speed' && p.cpuMoe === session.settings.cpuMoe && p.movaCpu === session.settings.movaCpu)}
        <p class="chat-note">Profilo a piena velocità: serve ~13 GB di VRAM solo per il chat — scarica prima il modello immagine (pagina Immagini), altrimenti non parte.</p>
      {/if}
      <Hintline>{status?.running
        ? (settingsDirty
          ? 'Impostazioni modificate: premi "applica" per riavviare il modello con i nuovi valori (la chat si svuota).'
          : Text.statusLine(status))
        : 'Scegli un modello qui sopra e premi "avvia" (o apri il selettore e clicca la sua scheda per caricarlo sulla GPU).'}</Hintline>
    </div>
  </aside>
{/if}

<div class="chat-area">
  <div class="chat-col">
    <div class="chat-scroll" bind:this={logEl} onscroll={onLogScroll}>
      <div class="chat-log" aria-live="polite">
        <MessageList
          messages={session.messages}
          serverRunning={!!status?.running}
          serverReady={!!status?.ready}
          modelName={loaded?.name ?? session.model}
          kbOn={session.kbOn}
          copied={copied}
          oncopy={copyMsg}
          onopen={openCited}
        />
      </div>
    </div>

    <div class="chat-composer">
      <div class="chat-composer-inner">
        {#if session.stats}
          <p class={`chat-stats ${session.stats.live ? 'live' : ''}`} role="status">
            {#if session.stats.live}
              generazione… <strong>≈{session.stats.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</strong> tok/s
            {:else}
              <strong>{session.stats.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</strong> tok/s
              {#if session.stats.tokens != null} · {session.stats.tokens} token{/if}
            {/if}
          </p>
        {/if}
        <form class="composer-box" onsubmit={send}>
          <textarea
            class="composer-input"
            bind:this={taEl}
            bind:value={session.input}
            oninput={autoGrow}
            onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) } }}
            placeholder={status?.ready
              ? (session.kbOn ? 'Domanda con le tue fonti… (Invio invia)' : `Chiedi qualcosa a ${loaded?.name ?? 'Ornith'}… (Invio invia, Shift+Invio a capo)`)
              : 'Server spento: premi "avvia" qui sopra.'}
            aria-label="Messaggio"
            rows={1}
            disabled={!status?.ready}
          ></textarea>
          {#if session.sending}
            <button class="send-btn stop" type="button" onclick={stopGen} title="Ferma la generazione" aria-label="Ferma la generazione">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <rect x="3" y="3" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          {:else}
            <button class="send-btn" type="submit"
              disabled={!status?.ready || !session.input.trim()}
              title="Invia" aria-label="Invia">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 8l11-5-3.5 9-2.2-3.6L2 8z" fill="currentColor" />
              </svg>
            </button>
          {/if}
        </form>
        <Hintline err={!!session.err}>{session.err}</Hintline>
        {#if session.kbOn && !session.err}
          <Hintline cls="kb-note">
            knowledge on — prima di ogni domanda recupero i frammenti rilevanti dalle tue fonti in knowledge/raw/
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
