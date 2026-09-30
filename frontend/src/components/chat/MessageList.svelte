<script lang="ts">
  // Registro della conversazione: stato vuoto + bolle utente + risposte con
  // reasoning, markdown, fonti citate e copia. Presentazionale: lo stato
  // (messages, sending…) resta nella pagina Chat, qui solo resa + eventi.
  import Markdown from '../Markdown.svelte'
  import ReasonBlock from '../ReasonBlock.svelte'
  import SourceCards from '../SourceCards.svelte'
  import { EmptyState } from '../ui'
  import type { KbChunkHit } from '../../api'
  import { citedChunks } from '../../lib/rag'
  import { msgText, type ViewMsg } from '../../lib/chat-view'

  let {
    messages,
    serverRunning,
    serverReady,
    modelName,
    kbOn,
    copied,
    oncopy,
    onopen,
  }: {
    messages: ViewMsg[]
    serverRunning: boolean
    serverReady: boolean
    modelName: string
    kbOn: boolean
    copied: number | null
    oncopy: (i: number) => void
    onopen: (chunk: KbChunkHit) => void
  } = $props()
</script>

{#if messages.length === 0}
  <EmptyState cls="chat-empty">
    {#if !serverRunning}
      <p class="empty-title">Server spento</p>
      <p>Premi <strong>avvia</strong> qui sopra per caricare {modelName} sulla GPU, poi scrivi qui sotto.</p>
    {:else if !serverReady}
      <p class="empty-title">In caricamento…</p>
      <p>{modelName} sta entrando in VRAM. Ancora qualche secondo, poi si può scrivere.</p>
    {:else}
      <p class="empty-title">{modelName}, in casa</p>
      <p>Scrivi una domanda e premi Invio per parlare con {modelName}.</p>
      {#if kbOn}<p class="empty-note">knowledge on — risponderà citando le tue fonti.</p>{/if}
    {/if}
  </EmptyState>
{:else}
  {#each messages as m, i (i)}
    {#if m.role === 'user'}
      <div class="bubble user">{msgText(m)}</div>
    {:else}
      <div class="msg assistant">
        <span class="avatar" aria-hidden="true">{modelName.charAt(0).toUpperCase()}</span>
        <div class="msg-body">
          {#if m.reason}<ReasonBlock text={m.reason} streaming={!!m.pending} />{/if}
          <div class="msg-text" data-idx={i}>
            <Markdown text={msgText(m)} cites={!!m.retr && (m.cites?.length ?? 0) > 0} />
            {#if m.pending}<span class="caret" aria-hidden="true"></span>{/if}
          </div>
          {#if m.retr && !m.pending && (m.cites?.length ?? 0) > 0}
            <SourceCards items={citedChunks(m.retr, msgText(m))} onopen={onopen} />
          {/if}
          {#if !m.pending && msgText(m).trim()}
            <div class="msg-actions">
              <button type="button" class="msg-act" onclick={() => oncopy(i)} aria-label="Copia risposta">
                {copied === i ? 'copiato' : 'copia'}
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/each}
{/if}
