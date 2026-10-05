<script lang="ts">
  // Palamede — Osservatorio: il canvas 3D e il suo sovrapposto.
  //
  // Il componente fa tre cose e non una quarta: crea la scena, la tiene
  // aggiornata con i dati che arrivano dallo store, e restituisce i click.
  // Non calcola nulla sui pesi — quelli arrivano già aggregati e misurati dal
  // backend, e qui si traduce solo in aspetto.
  import { onMount } from 'svelte'
  import { Brain } from '../scene/brain'
  import { obs } from '../store.svelte'
  import { Button } from '../../../components/ui'
  import { int } from '../format'

  let { onpick }: { onpick?: () => void } = $props()

  let host = $state<HTMLDivElement | null>(null)
  let canvas = $state<HTMLCanvasElement | null>(null)
  let brain: Brain | null = null
  let fps = $state(0)
  let hover = $state<string | null>(null)
  let failed = $state<string | null>(null)

  // la scena segue i dati: cambiano i gradienti a ogni `step`
  $effect(() => {
    if (!brain) return
    brain.setStats(obs.nodeStats, obs.moduleStats)
  })

  $effect(() => {
    if (!brain) return
    brain.setActivations(obs.last?.activations ?? {})
  })

  $effect(() => {
    if (!brain) return
    const sel = obs.selection
    brain.setSelection(sel?.kind === 'module' ? sel.id : sel?.kind === 'node' ? sel.id : null)
  })

  $effect(() => {
    if (!brain) return
    brain.setIsolated(obs.isolated)
  })

  // la grafo arriva una volta sola (o quando cambia la modalità): se lo
  // ricostruissimo a ogni update le lastre impazzirebbero sotto le dita
  $effect(() => {
    if (!brain || !obs.graph) return
    brain.setGraph(obs.graph)
  })

  $effect(() => {
    if (!brain) return
    brain.focus(obs.focusNode)
  })

  function pickNode(id: string) {
    obs.selectNode(id)
    onpick?.()
  }

  function pickModule(id: string) {
    obs.selectModule(id)
    onpick?.()
  }

  function global() {
    obs.goGlobal()
  }

  onMount(() => {
    if (!canvas || !host) return
    const ro = new ResizeObserver(() => brain?.resize())
    ro.observe(host)

    let disposed = false
    ;(async () => {
      try {
        const b = new Brain(canvas!, {
          onPickNode: pickNode,
          onPickModule: pickModule,
          onHover: (h) => (hover = h),
          onFps: (f) => (fps = f),
        })
        await b.init()
        if (disposed) {
          b.dispose()
          return
        }
        brain = b
        if (obs.graph) b.setGraph(obs.graph)
        if (obs.focusNode) b.focus(obs.focusNode)
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e)
      }
    })()

    return () => {
      disposed = true
      ro.disconnect()
      brain?.dispose()
      brain = null
    }
  })
</script>

<div class="obs-scene" bind:this={host}>
  <canvas bind:this={canvas} aria-label="Rappresentazione 3D del modello"></canvas>

  {#if failed}
    <div class="obs-scene-err">
      <strong>WebGL non disponibile</strong>
      <span>{failed}</span>
    </div>
  {/if}

  <!-- sovraposto: stato, legenda dei colori, navigazione -->
  <div class="obs-hud">
    <div class="obs-hud-row">
      <span class="obs-fps" title="frame al secondo della scena 3D">
        {fps.toFixed(0)} fps
      </span>
      {#if hover}
        <span class="obs-hover">{hover}</span>
      {:else}
        <span class="obs-hover dim">passa sopra un nodo</span>
      {/if}
    </div>

    <div class="obs-hud-row">
      {#if obs.focusNode}
        <Button variant="ghost" onclick={global}>← vista globale</Button>
        <span class="obs-focus">
          {obs.graph?.nodes.find((n) => n.id === obs.focusNode)?.label ?? obs.focusNode}
        </span>
      {/if}
      {#if obs.isolated}
        <Button variant="ghost" onclick={() => (obs.isolated = null)}>
          mostra tutto
        </Button>
      {/if}
    </div>
  </div>

  <!-- legenda dei colori: l'unico canale categorico della scena -->
  <div class="obs-colors">
    <span><i style="background:#8b93ff"></i>embeddings</span>
    <span><i style="background:#34d399"></i>short conv</span>
    <span><i style="background:#fbbf24"></i>attention</span>
    <span><i style="background:#c084fc"></i>lm head</span>
  </div>

  {#if obs.graph}
    <div class="obs-arch">
      {obs.graph.model.total_params ? int(obs.graph.model.total_params) : '—'} param ·
      {obs.graph.model.num_hidden_layers} layer ·
      {obs.graph.model.attn_layers.length} attention + {obs.graph.model.conv_layers.length} short conv ·
      d_model {obs.graph.model.hidden_size}
    </div>
  {/if}
</div>
