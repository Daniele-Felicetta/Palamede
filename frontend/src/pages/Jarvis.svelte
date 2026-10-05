<script lang="ts">
  import { onMount } from 'svelte'
  import { startChat, chatStream, type ChatMessage } from '../api'
  import { Text } from '../lib/text'
  import { store } from '../store.svelte'

  let status = $state<any>(null)
  let err = $state('')
  let input = $state('')
  let log = $state<{ role: string; text: string }[]>([])
  let sending = $state(false)

  async function refresh() {
    try {
      const r = await fetch('/api/jarvis/status')
      status = await r.json()
    } catch {
      err = 'hub non raggiungibile — avvia con start.bat'
    }
  }

  // F0/F1: push-to-talk testuale sul Brain Gemma (stesso /api/chat della Chat).
  // La voce vera (mic → Parakeet, audio ← Chatterbox) arriva in F3 via LiveKit.
  async function ask() {
    if (!input.trim() || sending) return
    sending = true
    err = ''
    const q = input
    input = ''
    log = [...log, { role: 'tu', text: q }]
    try {
      const d = Text.defaultsFor('gemma-4-12b')
      await startChat({ model: 'gemma-4-12b', ...d })
      const history: ChatMessage[] = [{ role: 'user', content: q }]
      const stream = await chatStream(history, 0.6, 'Sei Jarvis, assistente vocale locale. Rispondi in italiano, 1-2 frasi brevi.')
      let text = ''
      Text.stream(stream, (_t, delta) => { text += delta }, () => {
        log = [...log, { role: 'jarvis', text }]
        sending = false
      }, (e) => { err = String(e?.message ?? e); sending = false })
    } catch (e: unknown) {
      err = String((e as Error)?.message ?? e)
      sending = false
    }
  }

  onMount(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t) })
</script>

<h2>Jarvis <small>voce locale · F0 testuale</small></h2>
<p class="muted">Brain Gemma 12B IT + Ear Parakeet + Mouth Chatterbox-V3/Kokoro. Il loop microfono→audio si accende in F3 (LiveKit WebRTC); qui validiamo Brain + tool via testo.</p>

{#if err}<p class="err">{err}</p>{/if}

{#if status}
  <ul class="flags">
    <li>Brain Gemma: {status.files?.brain ? '✅' : '❌'}</li>
    <li>Parakeet GGUF: {status.files?.stt_gguf ? '✅' : '❌'}</li>
    <li>Chatterbox V3: {status.files?.tts_t3 ? '✅' : '❌'}</li>
    <li>Kokoro fallback: {status.files?.tts_fallback ? '✅' : '❌'}</li>
    <li>Wake ehi_jarvis: {status.wakeTrained ? '✅ allenata' : '⏳ da allenare (F2)'}</li>
    <li>Chat :8121: {store.chat?.running ? `on (${store.chat?.model})` : 'off'}</li>
  </ul>
{:else}
  <p class="muted">carico stato…</p>
{/if}

<div class="jarvis-log">
  {#each log as m}
    <p><b>{m.role}:</b> {m.text}</p>
  {/each}
</div>

<div class="row">
  <input placeholder="Chiedi a Jarvis (testo, F0)…" bind:value={input} onkeydown={(e) => e.key === 'Enter' && ask()} />
  <button onclick={ask} disabled={sending}>{sending ? '…' : 'Chiedi'}</button>
</div>

<style>
  .muted { opacity: .7 }
  .err { color: #f66 }
  .flags { columns: 2; font-size: .9em }
  .jarvis-log { border: 1px solid #333; border-radius: 8px; padding: .5em 1em; min-height: 6em; margin: 1em 0 }
  .row { display: flex; gap: .5em }
  .row input { flex: 1; padding: .5em }
</style>
