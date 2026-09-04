<script lang="ts">
  import { onMount } from 'svelte'
  import { chatStream, getChatStatus, getKbStatus, readKbFile, searchKb, startChat, stopChat } from '../api'
  import type { ChatMessage, ChatStatus } from '../api'
  import { Text } from '../lib/text'
  import Markdown from '../components/Markdown.svelte'
  import ReasonBlock from '../components/ReasonBlock.svelte'
  import { Button, ChatState, EmptyState, Field, Hintline, ModelPlate } from '../components/ui'

  interface Msg extends ChatMessage { pending?: boolean; reason?: string }

  // Ragionamento pieghevole: resta aperto durante lo streaming, poi l'utente
  // decide (ogni messaggio con il proprio stato).
  let status = $state<ChatStatus | null>(null)
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

  const refresh = async () => {
    try { status = await getChatStatus() } catch { status = null }
  }
  onMount(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  })

  $effect(() => {
    void messages.length
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
      status = st
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  const stop = async () => {
    busy = true; err = ''
    try { status = await stopChat() } catch (e) { err = String(e) } finally { busy = false }
  }

  // Contesto knowledge base per una domanda: cerca le pagine wiki rilevanti
  // e le mette in un system prompt. Errore silenzioso → chat senza contesto.
  const kbContext = async (text: string): Promise<string | null> => {
    if (!kbOn) return null
    try {
      const st = await getKbStatus()
      const pages = (await searchKb(text)).pages
      const parts: string[] = []
      if (pages.length) {
        for (const p of pages) {
          try {
            const f = await readKbFile('wiki/' + p)
            parts.push(`\n## ${p}\n${f.content.slice(0, 4000)}`)
          } catch { /* pagina non leggibile, skip */ }
        }
      } else if (st.wiki > 0) {
        // nessuna pagina rilevante: dai almeno l'indice al modello
        parts.push('\n' + st.index.slice(0, 3000))
      }
      if (!parts.length) return null
      const sys = `Hai una knowledge base locale (wiki in knowledge/). Usala per rispondere: cita le fonti tra parentesi, non inventare. Ecco le pagine rilevanti per questa domanda:${parts.join('\n')}`
      return sys
    } catch {
      return null
    }
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
    const already = status?.running && status?.model === id
    model = id
    const cpuMoe = Text.supportsCpuMoe(id) ? settings.cpuMoe : 0
    if (already) return // già attivo: nessuna azione
    err = ''
    busy = true
    try {
      messages = []
      const st = await startChat({ model: id, ...settings, cpuMoe })
      status = st
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

  <header class="chat-page-head">
    <h1 class="chat-page-title">Ornith, <em>in casa</em>.</h1>
    <div class="chat-head-tools">
      <div class="chat-plates" role="radiogroup" aria-label="Modello chat">
        {#each Text.MODELS as m (m.id)}
          {@const active = status?.running && status?.model === m.id}
          {@const loading = status?.running && status?.model === m.id && !status?.ready}
          {@const state = active ? (loading ? 'busy' : 'on') : (model === m.id ? 'sel' : 'off')}
          <ModelPlate
            small
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
      <div class="chat-head-status">
        <ChatState state={status?.ready ? 'on' : 'off'}>
          {status?.running
            ? (status.ready ? 'pronto' : 'in caricamento…')
            : 'spento'}
        </ChatState>
        {#if status?.running}
          <Button variant="ghost" onclick={stop} disabled={busy}>
            ferma
          </Button>
        {:else}
          <Button onclick={apply} disabled={busy}>
            {busy ? 'avvio…' : 'avvia'}
          </Button>
        {/if}
      </div>
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
  </header>

  {#if settingsOpen}
    <div class="chat-settings-panel">
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
        {#if Text.isMoe(model)}
          <Field label="Layer MoE su CPU" for="cmoe">
            <input id="cmoe" type="number" min={0} max={64}
              value={settings.cpuMoe}
              oninput={(e) => settings.cpuMoe = Math.max(0, Number(e.currentTarget.value) || 0)}
              title="Sposta i pesi degli esperti MoE dei primi N layer sulla CPU (libera VRAM)" />
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
      <Hintline>{status?.running
        ? Text.statusLine(status)
        : 'Scegli un modello qui sopra e premi "avvia" (o clicca direttamente la sua scheda per caricarlo sulla GPU).'}</Hintline>
    </div>
  {/if}

  <div class="chat-area">
    <div class="chat-col">
      <section class="chat-scroll">
        <div class="chat-log" bind:this={logEl} onscroll={onLogScroll} aria-live="polite">
          {#if messages.length === 0}
            <EmptyState cls="chat-empty">
              Nessuna conversazione.<br />Scrivi sotto e premi Invio per parlare con Ornith.
            </EmptyState>
          {:else}
            {#each messages as m, i (i)}
              {#if m.role === 'user'}
                <div class="bubble user">{m.content}</div>
              {:else}
                <div class="msg assistant">
                   <span class="avatar" aria-hidden="true">O</span>
                  <div class="msg-body">
                    {#if m.reason}<ReasonBlock text={m.reason} streaming={!!m.pending} />{/if}
                    <div class="msg-text">
                      <Markdown text={m.content} />
                       {#if m.pending}<span class="caret" aria-hidden="true"></span>{/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
          {/if}
        </div>

      </section>

      <div class="chat-composer">
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
