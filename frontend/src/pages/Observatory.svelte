<script lang="ts">
  // Palamede — Osservatorio neurale: la pagina.
  //
  // Orchestrazione e nient'altro: apre lo stream eventi, carica il modello se
  // non c'è, e mette in fila i pannelli. Tutta la logica dei pesi sta nel
  // backend Python — qui arrivano numeri già misurati.
  //
  // Layout a tre colonne (controlli · cervello 3D · inspector) con la striscia
  // dei grafici sotto e la cronologia a lato. Le colonne collassano da sole
  // sotto i 1200 px: su uno schermo stretto la scena 3D resta l'elemento
  // grande e i pannelli passano sotto.

  import { onMount } from 'svelte'
  import { connect, loadModel, ObservatoryError } from '../lib/observatory/api'
  import type { EventKind, Stream } from '../lib/observatory/api'
  import type { HelloPayload, StepEvent, UpdateEnd, UpdateStart } from '../lib/observatory/types'
  import { obs } from '../lib/observatory/store.svelte'
  import { Eyebrow, SectionHead } from '../components/ui'
  import BrainCanvas from '../lib/observatory/components/BrainCanvas.svelte'
  import Controls from '../lib/observatory/components/Controls.svelte'
  import Inspector from '../lib/observatory/components/Inspector.svelte'
  import Legend from '../lib/observatory/components/Legend.svelte'
  import TokenView from '../lib/observatory/components/TokenView.svelte'
  import HistoryPanel from '../lib/observatory/components/HistoryPanel.svelte'
  import Strip from '../lib/observatory/components/Strip.svelte'
  import '../styles/observatory.css'

  let stream: Stream | null = null
  let narrow = $state(false)
  let tab = $state<'tokens' | 'history'>('tokens')

  function applyHello(d: HelloPayload) {
    obs.config = d.config
    obs.state = d.state
    obs.gpu = d.gpu
    obs.vram = d.vram
    obs.graph = d.graph
    obs.model = d.model
    obs.mode = d.mode
    obs.history = d.history
    obs.legend = d.legend
    obs.disclaimer = d.disclaimer
  }

  function onEvent(kind: EventKind, d: Record<string, unknown>) {
    switch (kind) {
      case 'hello':
        applyHello(d as unknown as HelloPayload)
        break

      case 'status': {
        const s = d.state as HelloPayload['state']
        obs.state = s
        break
      }

      case 'model_state': {
        const m = d.model as HelloPayload['model']
        obs.model = m
        obs.state = d.state as HelloPayload['state']
        break
      }

      case 'graph':
        obs.graph = d.graph as HelloPayload['graph']
        break

      case 'history':
        obs.history = (d.history as HelloPayload['history']) ?? []
        break

      case 'update_start': {
        const u = d as unknown as UpdateStart
        obs.live = u
        obs.step = null
        obs.stepsSeen = 0
        obs.running = true
        obs.paused = null
        obs.tokenIndex = null
        break
      }

      case 'step': {
        // questo è il feed della scena 3D: arriva a ogni optimizer step, quindi
        // il cervello si muove DURANTE l'update e non solo alla fine
        obs.step = d as unknown as StepEvent
        obs.stepsSeen += 1
        break
      }

      case 'paused':
        obs.paused = { step: (d.step as number) ?? 0, steps: (d.steps as number) ?? 0 }
        obs.state = d.state as HelloPayload['state']
        break

      case 'update_end': {
        const u = d as unknown as UpdateEnd
        obs.last = u
        obs.live = null
        obs.step = null
        obs.running = false
        obs.paused = null
        obs.state = d.state
          ? (d.state as HelloPayload['state'])
          : obs.state
        // la cronologia la ricalcola il backend: chiediamo il riepilogo
        refreshHistory()
        break
      }

      case 'error':
        obs.say('error', String(d.error ?? 'errore sconosciuto'))
        obs.running = false
        break
    }
  }

  async function refreshHistory() {
    try {
      const r = await fetch('/api/observatory/api/history')
      if (r.ok) obs.history = ((await r.json()) as { history: typeof obs.history }).history
    } catch {
      /* la cronologia si aggiorna comunque al prossimo update */
    }
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 1200px)')
    const apply = () => (narrow = mq.matches)
    apply()
    mq.addEventListener('change', apply)

    stream = connect(
      onEvent,
      (up, note) => {
        obs.connected = up
        obs.connectionNote = note
        if (up) obs.ready = true
      },
    )

    return () => {
      stream?.close()
      mq.removeEventListener('change', apply)
    }
  })

  // il modello si carica da solo la prima volta: il pulsante resta per chi
  // vuole controllare il momento (e per ricaricare dopo un reset)
  $effect(() => {
    if (!obs.ready || obs.state === null) return
    if (obs.state.loaded || obs.state.phase === 'loading') return
    loadModel().catch((e) => {
      obs.say(
        'error',
        e instanceof ObservatoryError ? e.message : 'caricamento fallito',
      )
    })
  })
</script>

<svelte:window onresize={() => undefined} />

<Eyebrow>Experimental · laboratorio</Eyebrow>
<SectionHead
  title="Osservatorio neurale"
  sub="LFM2.5 230M: un esempio alla volta, e guardi dentro i pesi mentre cambiano"
/>

<p class="lede">
  Dai un esempio al modello, fai uno o due optimizer step, e guarda cosa è
  successo davvero: il gradiente di ogni layer, quanto si è mosso ogni peso,
  quanto era l'attivazione prima e dopo. Ogni numero qui è letto dai tensori
  del checkpoint — niente animazioni a caso.
</p>

{#if !obs.connected}
  <p class="obs-off" role="status">
    <strong>Backend non raggiungibile.</strong>
    Avvialo con
    <code>scripts\start-observatory.ps1</code> (porta 8131).
    {#if obs.connectionNote}<span class="dim">{obs.connectionNote}</span>{/if}
  </p>
{:else if obs.state?.error}
  <p class="obs-off" role="alert">
    <strong>Errore nel backend.</strong>
    {obs.state.error}
  </p>
{/if}

{#if obs.state?.phase === 'training' && obs.live}
  <div class="obs-runhead" role="status">
    <span class="obs-run-n">EXAMPLE #{obs.live.index}</span>
    <span class="obs-run-p">
      {obs.live.prompt}<em>→</em>{obs.live.target}
    </span>
    {#if obs.paused}
      <span class="obs-run-paused">
        fermo allo step {obs.paused.step}/{obs.paused.steps} — «prossimo step»
      </span>
    {:else if obs.step}
      <span class="obs-run-step">
        step {obs.step.step}/{obs.step.steps} · loss {obs.step.loss.toFixed(4)} ·
        ∇ {obs.step.grad_norm_global.toFixed(3)} · {obs.step.timing.total_ms.toFixed(0)} ms
      </span>
    {/if}
  </div>
{/if}

<!-- layout: controlli · cervello · inspector -->
<div class="obs-grid" class:narrow>
  <div class="obs-col-left">
    <Controls />
  </div>

  <div class="obs-col-mid">
    <BrainCanvas />
    <Strip />
    <nav class="obs-tabs" aria-label="pannelli sotto la scena">
      <button class:on={tab === 'tokens'} onclick={() => (tab = 'tokens')}>token</button>
      <button class:on={tab === 'history'} onclick={() => (tab = 'history')}>
        aggiornamenti{obs.history.length ? ` (${obs.history.length})` : ''}
      </button>
      <Legend />
    </nav>
    {#if tab === 'tokens'}
      <TokenView />
    {:else}
      <HistoryPanel />
    {/if}
  </div>

  <div class="obs-col-right">
    <Inspector />
    {#if obs.last}
      <section class="obs-ba">
        <h4>prima e dopo</h4>
        <div class="obs-ba-row">
          <span class="obs-ba-k">prima</span>
          <output>{obs.last.output_before || '(vuoto)'}</output>
        </div>
        <div class="obs-ba-row">
          <span class="obs-ba-k">dopo</span>
          <output class="after">{obs.last.output_after || '(vuoto)'}</output>
        </div>
        <dl class="obs-kv">
          <dt>perdita</dt>
          <dd>
            {obs.last.loss_before.toFixed(4)} → <strong>{obs.last.loss_after.toFixed(4)}</strong>
            {#if obs.last.loss_after < obs.last.loss_before}
              <span class="obs-badge ok">−{(obs.last.loss_before - obs.last.loss_after).toFixed(4)}</span>
            {:else}
              <span class="obs-badge hot">+{(obs.last.loss_after - obs.last.loss_before).toFixed(4)}</span>
            {/if}
          </dd>
          <dt>perplessità</dt>
          <dd>{obs.last.perplexity_before.toFixed(2)} → {obs.last.perplexity_after.toFixed(2)}</dd>
          <dt>tensori cambiati</dt>
          <dd>
            {obs.last.totals.changed_tensors}/{obs.last.totals.tensors}
          </dd>
          <dt>delta azzerati</dt>
          <dd class:hot-n={obs.last.totals.rounded_away_tensors > 0}>
            {obs.last.totals.rounded_away_tensors}
          </dd>
          <dt>tempo totale</dt>
          <dd>{obs.last.timing.total_ms.toFixed(0)} ms</dd>
        </dl>
      </section>
    {/if}
  </div>
</div>

{#if obs.notice}
  <p class="obs-notice" class:err={obs.notice.kind === 'error'} role="status">
    {obs.notice.text}
  </p>
{/if}

<p class="obs-foot dim">
  Osservatorio neurale · backend Python su <code>:8131</code> · eventi su
  <code>text/event-stream</code> · LFM2.5 ibrido: short-conv e attention
  alternati, niente struttura Llama.
</p>
