<script lang="ts">
  // Palamede — Osservatorio: la striscia in basso.
  //
  // Quattro grafici minimi, disegnati in SVG inline: perdita, delta dei pesi,
  // memoria video e tempi per fase. Niente librerie di grafici — quattro
  // polilinee non giustificano 200 KB di bundle, e il repo non ne ha già una.

  import { obs } from '../store.svelte'
  import { ms, num } from '../format'

  interface Series {
    id: number
    loss: number
    delta: number
    vram: number
    ms: number
    phase: string
  }

  /** Un punto per ogni update: la cronologia come serie temporale. */
  const series = $derived.by<Series[]>(() =>
    obs.history.map((h) => ({
      id: h.index,
      loss: h.loss_after,
      delta: h.delta_norm,
      vram: 0,
      ms: h.total_ms,
      phase: h.mode,
    })),
  )

  const liveLoss = $derived.by(() => {
    const l = obs.last
    if (!l) return null
    return [
      { x: 0, y: l.loss_before },
      ...l.steps_detail.map((s, i) => ({ x: i + 1, y: s.loss })),
    ]
  })

  const vramNow = $derived(obs.state?.vram ?? null)
  const gpu = $derived(obs.state?.gpu ?? null)

  /** Polilinea normalizzata nel box 0..100 × 0..28. */
  function path(values: { x: number; y: number }[], w = 100, h = 28): string {
    if (values.length < 2) return ''
    const ys = values.map((v) => v.y)
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    const span = hi - lo || 1
    const xs = values.map((v) => v.x)
    const x0 = Math.min(...xs)
    const xspan = Math.max(...xs) - x0 || 1
    return values
      .map(
        (v) =>
          `${v.x === x0 ? 'M' : 'L'}${(((v.x - x0) / xspan) * w).toFixed(2)},${(h - ((v.y - lo) / span) * h).toFixed(2)}`,
      )
      .join(' ')
  }

  function bars(vals: number[], w = 100, h = 28): string {
    if (!vals.length) return ''
    const mx = Math.max(...vals, 1e-12)
    const bw = w / vals.length
    return vals
      .map((v, i) => {
        const bh = Math.max(1, (v / mx) * h)
        return `<rect x="${(i * bw + bw * 0.2).toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${(bw * 0.6).toFixed(2)}" height="${bh.toFixed(2)}" rx="0.5"/>`
      })
      .join(' ')
  }

  // `at(-1)` richiederebbe lib es2022 nel tsconfig: questo progetto compila
  // con una lib più vecchia, quindi l'indice esplicito.
  const lastStep = $derived(
    (() => {
      const d = obs.last?.steps_detail
      return d && d.length ? d[d.length - 1] : null
    })(),
  )
  const stepTiming = $derived(lastStep?.timing ?? null)
</script>

<section class="obs-strip" aria-label="Grafici">
  <!-- perdita: dentro l'ultimo update e nella cronologia -->
  <div class="obs-chart">
    <span class="obs-chart-t">
      perdita
      {#if obs.last}
        <strong>{obs.last.loss_after.toFixed(3)}</strong>
        <span class="dim">da {obs.last.loss_before.toFixed(3)}</span>
      {/if}
    </span>
    {#if liveLoss && liveLoss.length > 1}
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img"
           aria-label="perdita per step dell'ultimo aggiornamento">
        <path d={path(liveLoss)} fill="none" stroke="#8b93ff" stroke-width="1.4" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="obs-chart-s">
        {#each liveLoss as p, i (i)}<em>{p.y.toFixed(3)}</em>{/each}
      </span>
    {:else}
      <span class="obs-chart-empty">serve un update con almeno 2 step</span>
    {/if}
  </div>

  <!-- delta dei pesi: una barra per update -->
  <div class="obs-chart">
    <span class="obs-chart-t">
      ‖δ‖ per update
      {#if obs.last}<strong>{num(obs.last.totals.delta_norm)}</strong>{/if}
    </span>
    {#if series.length > 1}
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img"
           aria-label="norma del delta per ogni aggiornamento">
        <g fill="#34d399">{@html bars(series.map((s) => s.delta))}</g>
      </svg>
      <span class="obs-chart-s dim">{series.length} aggiornamenti</span>
    {:else}
      <span class="obs-chart-empty">serve almeno 2 aggiornamenti</span>
    {/if}
  </div>

  <!-- gradiente per layer: la barra Layer 0 ░░░ / Layer 3 ███████ -->
  <div class="obs-chart obs-chart-wide">
    <span class="obs-chart-t">
      gradiente per layer
      {#if obs.step}<strong>{num(obs.step.grad_norm_global)}</strong>{/if}
    </span>
    {#if obs.step && obs.step.layers.length}
      <div class="obs-layerbars">
        {#each obs.step.layers as l (l.id)}
          {@const pctg = Math.min(100, l.grad_pct_of_peak)}
          <div class="obs-lb" title={`${l.label}: gradiente ${num(l.grad_norm)} (${pctg.toFixed(0)}% del picco)`}>
            <span class="obs-lb-k">{l.label.replace('Layer ', '')}</span>
            <span class="obs-lb-b">
              <i style:width={`${pctg}%`}></i>
              <em>{(pctg / 10).toFixed(0)}</em>
            </span>
          </div>
        {/each}
      </div>
      <span class="obs-chart-s dim">
        {obs.step.layers.filter((l) => l.id.startsWith('layer.')).length} layer · scala
        0–100 del picco · misura il gradiente, non il delta
      </span>
    {:else}
      <span class="obs-chart-empty">in attesa del primo step</span>
    {/if}
  </div>

  <!-- tempi reali -->
  <div class="obs-chart">
    <span class="obs-chart-t">
      tempi
      {#if stepTiming}<strong>{ms(stepTiming.total_ms)}</strong><span class="dim">/step</span>{/if}
    </span>
    {#if stepTiming}
      <div class="obs-times">
        <span title="forward pass">fwd <i>{ms(stepTiming.forward_ms)}</i></span>
        <span title="backward pass">bwd <i>{ms(stepTiming.backward_ms)}</i></span>
        <span title="optimizer step">opt <i>{ms(stepTiming.optimizer_ms)}</i></span>
        <span title="misura dei delta: fa parte dell'osservatorio, non del training">
          analisi <i>{ms(stepTiming.analyze_ms)}</i>
        </span>
      </div>
      {#if obs.last}
        <span class="obs-chart-s dim">
          generazione {obs.last.throughput.generate_before.tokens_per_second.toFixed(1)} tok/s ·
          prima {ms(obs.last.timing.inference_before_ms)} · dopo {ms(obs.last.timing.inference_after_ms)}
        </span>
      {/if}
    {:else}
      <span class="obs-chart-empty">in attesa del primo step</span>
    {/if}
  </div>

  <!-- VRAM -->
  <div class="obs-chart">
    <span class="obs-chart-t">
      memoria video
      {#if vramNow}<strong>{vramNow.max_allocated_mib.toFixed(0)}</strong><span class="dim">MiB picco</span>{/if}
    </span>
    {#if vramNow && gpu}
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img"
           aria-label="memoria video assegnata rispetto al totale">
        <rect x="0" y="0" width="100" height="28" fill="#161d2b" rx="2" />
        <rect
          x="0" y="0"
          width="{Math.min(100, (vramNow.allocated_mib / gpu.total_mib) * 100).toFixed(2)}"
          height="28" fill="#8b93ff" rx="2"
        />
        <rect
          x="0" y="0"
          width="{Math.min(100, (vramNow.max_allocated_mib / gpu.total_mib) * 100).toFixed(2)}"
          height="28" fill="none" stroke="#fbbf24" stroke-width="0.8"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <span class="obs-chart-s dim">
        {gpu.name} · assegnata {vramNow.allocated_mib.toFixed(0)} · riservata
        {vramNow.reserved_mib.toFixed(0)} · totale {gpu.total_mib.toFixed(0)} MiB
      </span>
    {:else}
      <span class="obs-chart-empty">nessuna GPU</span>
    {/if}
  </div>
</section>
