<script lang="ts">
  import { chatStream, startChat, stopChat } from '../api'
  import type { ChatMessage } from '../api'
  import { store } from '../store.svelte'
  import { Text } from '../lib/text'
  import { buildKbContext } from '../lib/kbContext'
  import Markdown from '../components/Markdown.svelte'
  import ReasonBlock from '../components/ReasonBlock.svelte'
  import { Button, ChatState, EmptyState, Field, Hintline, ModelPlate } from '../components/ui'

  interface Msg extends ChatMessage { pending?: boolean; reason?: string }

  // Testo leggibile di un messaggio: i contenuti multimodali (array di parti)
  // si riducono alle sole parti testuali.
  const msgText = (m: Msg): string =>
    typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')

  // Ragionamento pieghevole: resta aperto durante lo streaming, poi l'utente
  // decide (ogni messaggio con il proprio stato).
  // Lo stato del server arriva dallo store condiviso (un solo poller per la
  // app): qui niente polling duplicato. Le azioni scrivono l'esito in store.chat
  // per un aggiornamento immediato, poi il poller resta la fonte di verità.
  let status = $derived(store.chat)
  let busy = $state(false)
  let err = $state('')

  let model = $state<Text.ModelId>(Text.DEFAULT_MODEL)
  let settings = $state(Text.defaultsFor(Text.DEFAULT_MODEL))
  let settingsOpen = $state(false)

  // knowledge base (llm-wiki): se attiva, ogni domanda cerca le pagine
  // rilevanti e le inietta come contesto di sistema.
  let kbOn = $state(false)

  let messages = $state<Msg[]>([])
  let input = $state('')
  let sending = $state(false)

  // contatore tok/s: stima live durante la generazione, preciso a fine stream
  let stats = $state<{ tps: number; tokens: number | null; live: boolean } | null>(null)
  let genStart = 0
  let chars = 0

  // autoscroll "intelligente": segue la generazione solo se l'utente è già
  // in fondo, altrimenti resta dove sta (niente salti mentre legge).
  let logEl: HTMLDivElement | undefined = $state()
  let stick = true

  // Autoscroll in streaming: leggere anche contenuto/ragionamento dell'ultimo
  // messaggio (non solo la lunghezza dell'array) è ciò che fa ripartire
  // l'effetto a ogni token, altrimenti il log non segue la generazione.
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
      const st = await startChat({ model, ...settings })
      store.chat = st
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

  // Contesto knowledge base per una domanda (lib/kbContext.ts): cerca le
  // pagine wiki rilevanti e le inietta come system prompt. Null → chat liscia.
  const kbContext = async (text: string): Promise<string | null> => {
    if (!kbOn) return null
    return buildKbContext(text)
  }

  async function send(e: { preventDefault(): void }) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending || !status?.ready) return
    input = ''
    err = ''
    const history: ChatMessage[] = [
      ...messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    messages = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '', pending: true }]
    sending = true
    stats = null
    genStart = performance.now()
    chars = 0
    stick = true
    try {
      const system = await kbContext(text)
      const stream = await chatStream(history, settings.temperature, system ?? undefined)
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
        (st) => { if (st) stats = { tps: st.tps, tokens: st.tokens, live: false }; for (const m of messages) if (m.pending) m.pending = false },
        (er) => { err = er.message; for (const m of messages) if (m.pending) m.pending = false },
      )
    } catch (er) {
      err = er instanceof Error ? er.message : String(er)
      messages = messages.filter((m) => !m.pending)
    } finally {
      sending = false
    }
  }

  // Cambio modello esplicito (plate, stile pagina Immagini): il click
  // carica il modello scelto sulla GPU (riavviando se il server è già
  // attivo con un altro modello). La plate del modello attivo non fa nulla.
  const pickChatModel = async (id: Text.ModelId) => {
    if (busy) return
    model = id
    if (status?.running && status?.model === id) return // già attivo: nessuna azione
    // Cambio modello = parametri di fabbrica di QUEL modello (context/KV/temp):
    // senza reset resterebbero quelli del modello precedente (es. Gemma 26B
    // partirebbe con ctx 8192/q8_0 di Ornith invece di 4096/q4_0).
    settings = Text.defaultsFor(id)
    const cpuMoe = Text.supportsCpuMoe(id) ? settings.cpuMoe : 0
    err = ''
    busy = true
    try {
      messages = []
      const st = await startChat({ model: id, ...settings, cpuMoe })
      store.chat = st
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

  <header class="chat-head">
    <div class="chat-head-inner">
      <div class="chat-head-top">
        <h1 class="chat-title">Ornith, <em>in casa</em>.</h1>
        <div class="chat-head-actions">
          <ChatState state={status?.ready ? 'on' : 'off'}>
            {status?.running
              ? (status.ready ? 'pronto' : 'in caricamento…')
              : 'spento'}
          </ChatState>
          {#if status?.running}
            <Button variant="ghost" onclick={stop} disabled={busy}>ferma</Button>
          {:else}
            <Button onclick={apply} disabled={busy}>{busy ? 'avvio…' : 'avvia'}</Button>
          {/if}
          <Button
            variant="side"
            toggled={settingsOpen}
            onclick={() => settingsOpen = !settingsOpen}
            aria-expanded={settingsOpen}
          >
            impostazioni
          </Button>
          <Button
            variant="side"
            cls="kb-toggle"
            toggled={kbOn}
            onclick={() => kbOn = !kbOn}
            aria-pressed={kbOn}
            title="Usa la knowledge base (knowledge/) come contesto per ogni domanda"
          >
            {kbOn ? 'knowledge on' : 'knowledge off'}
          </Button>
        </div>
      </div>
      <div class="chat-plates" role="radiogroup" aria-label="Modello chat">
        {#each Text.MODELS as m (m.id)}
          {@const active = status?.running && status?.model === m.id}
          {@const loading = status?.running && status?.model === m.id && !status?.ready}
          {@const state = active ? (loading ? 'busy' : 'on') : (model === m.id ? 'sel' : 'off')}
          <ModelPlate
            small
            role="radio"
            aria-checked={model === m.id}
            selected={model === m.id}
            active={active}
            name={m.name}
            led={state === 'on' ? 'on' : state === 'busy' ? 'busy' : 'off'}
            stamps={[
              { text: m.family },
              { text: Text.modelStamp(m.id), tone: active ? 'ok' : 'hot' },
            ]}
            disabled={busy || (active && loading)}
            title={active
              ? (loading ? 'in caricamento…' : `modello attivo: ${m.name}. Premendo "ferma" lo scarichi dalla GPU`)
              : `carica ${m.name} nella GPU`}
            onclick={() => pickChatModel(m.id)}
          />
        {/each}
      </div>
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
          : 'Scegli un modello qui sopra e premi "avvia" (o clicca direttamente la sua scheda per caricarlo sulla GPU).'}</Hintline>
      </div>
    </div>
  {/if}

  <div class="chat-area">
    <div class="chat-col">
      <div class="chat-scroll" bind:this={logEl} onscroll={onLogScroll}>
        <div class="chat-log" aria-live="polite">
          {#if messages.length === 0}
            <EmptyState cls="chat-empty">
              Nessuna conversazione.<br />Scrivi sotto e premi Invio per parlare con Ornith.
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
                    <div class="msg-text">
                      <Markdown text={msgText(m)} />
                      {#if m.pending}<span class="caret" aria-hidden="true"></span>{/if}
                    </div>
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
                ? (kbOn ? 'Domanda con contesto knowledge base… (Invio invia)' : 'Chiedi qualcosa a Ornith… (Invio invia, Shift+Invio a capo)')
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
              knowledge on — prima di ogni domanda cerco le pagine wiki rilevanti in knowledge/
            </Hintline>
          {/if}
        </div>
      </div>
    </div>
  </div>
