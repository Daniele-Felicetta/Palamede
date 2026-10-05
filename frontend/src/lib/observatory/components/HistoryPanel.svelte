<script lang="ts">
  // Palamede — Osservatorio: time travel.
  //
  // Ogni update lascia una voce con le sue statistiche. Il confronto A vs B
  // lavora su quello che è registrato: perdita, delta per layer, output.
  // La distanza parametrica vera fra due stati dei pesi si calcola solo se
  // qualche update ha tenuto una copia dei pesi (`weight_snapshot_keep`), e
  // quando non c'è il pannello lo dice invece di far finta.

  import { obs } from '../store.svelte'
  import { Button, Stamp } from '../../../components/ui'
  import { clip, clock, ms, num } from '../format'

  const items = $derived(obs.history)
  const cmp = $derived(obs.comparison)

  function pick(i: number) {
    if (obs.compareA === i) return
    if (obs.compareB === i) return
    if (obs.compareA == null) obs.compareA = i
    else if (obs.compareB == null) obs.compareB = i
    else {
      obs.compareA = obs.compareB
      obs.compareB = i
    }
    obs.comparison = null
  }

  /** Barre dei due delta a confronto, scala comune al massimo dei due. */
  function scale(a: number, b: number): number {
    return Math.max(1e-12, Math.max(a, b))
  }
</script>

<section class="obs-history" aria-label="Cronologia">
  <h4>
    aggiornamenti
    <span class="dim">({items.length})</span>
  </h4>

  {#if !items.length}
    <div class="obs-empty">
      <strong>Nessun update</strong>
      <p>Il primo esempio allenato appare qui.</p>
    </div>
  {:else}
    <div class="obs-hist" role="list">
      {#each [...items].reverse() as h (h.index)}
        <div
          class="obs-hist-i"
          class:a={obs.compareA === h.index}
          class:b={obs.compareB === h.index}
          role="listitem"
        >
          <button class="obs-hist-b" onclick={() => pick(h.index)}>
            <span class="obs-hist-n">#{h.index}</span>
            <span class="obs-hist-p">{clip(h.prompt, 30)}</span>
            <span class="obs-hist-t dim">→ {clip(h.target, 18)}</span>
            <span class="obs-hist-m">
              <span class="obs-hist-loss">
                {h.loss_before.toFixed(2)}<i>→</i><strong>{h.loss_after.toFixed(2)}</strong>
              </span>
              {#if h.output_changed}
                <span class="obs-badge" title="l'output è cambiato">testo ≠</span>
              {/if}
            </span>
            <span class="obs-hist-meta dim">
              {h.mode} · {h.steps} step · {ms(h.total_ms)} · ‖δ‖ {num(h.delta_norm)} · {clock(h.ts)}
            </span>
          </button>
        </div>
      {/each}
    </div>

    <div class="obs-cmpbar">
      <span>
        confronto
        <strong>{obs.compareA == null ? '—' : `#${obs.compareA}`}</strong>
        vs
        <strong>{obs.compareB == null ? '—' : `#${obs.compareB}`}</strong>
      </span>
      <Button
        variant="ghost"
        onclick={() => obs.doCompare()}
        disabled={obs.compareA == null || obs.compareB == null || obs.state?.busy}
      >
        confronta
      </Button>
    </div>

    {#if cmp}
      <div class="obs-cmp">
        <dl class="obs-kv">
          <dt>perdita</dt>
          <dd>
            #{cmp.a.index}: {cmp.loss.before_a.toFixed(3)} → {cmp.loss.after_a.toFixed(3)}
            (guadagno {cmp.loss.gain_a.toFixed(3)})
          </dd>
          <dd>
            #{cmp.b.index}: {cmp.loss.before_b.toFixed(3)} → {cmp.loss.after_b.toFixed(3)}
            (guadagno {cmp.loss.gain_b.toFixed(3)})
          </dd>
          <dt>delta-norm</dt>
          <dd>
            {num(cmp.totals.delta_norm_a ?? null)} → {num(cmp.totals.delta_norm_b ?? null)}
          </dd>
          <dt>gradiente</dt>
          <dd>
            {num(cmp.totals.grad_norm_a ?? null)} → {num(cmp.totals.grad_norm_b ?? null)}
          </dd>
          <dt>uscita A</dt>
          <dd><code>{clip(cmp.output.a_after, 46) || '(vuoto)'}</code></dd>
          <dt>uscita B</dt>
          <dd><code>{clip(cmp.output.b_after, 46) || '(vuoto)'}</code></dd>
          <dt>distanza pesi</dt>
          <dd>
            {#if cmp.exact_weight_distance}
              {num(cmp.exact_weight_distance.total)} (‖W_a − W_b‖ sui tensori trainabili)
            {:else}
              <span class="dim">{cmp.exact_weight_distance_note}</span>
            {/if}
          </dd>
        </dl>

        <table class="obs-cmptbl">
          <thead>
            <tr>
              <th>layer</th>
              <th>‖δ‖ #{cmp.a.index}</th>
              <th>‖δ‖ #{cmp.b.index}</th>
              <th>variazione</th>
            </tr>
          </thead>
          <tbody>
            {#each cmp.layers as l (l.id)}
              {@const mx = scale(l.delta_norm_a, l.delta_norm_b)}
              <tr>
                <th scope="row">{l.label}</th>
                <td>
                  <span class="obs-cmpbar2">
                    <i class="a" style:width={`${(l.delta_norm_a / mx) * 100}%`}></i>
                  </span>
                  <span class="num">{num(l.delta_norm_a)}</span>
                </td>
                <td>
                  <span class="obs-cmpbar2">
                    <i class="b" style:width={`${(l.delta_norm_b / mx) * 100}%`}></i>
                  </span>
                  <span class="num">{num(l.delta_norm_b)}</span>
                </td>
                <td>
                  {l.delta_norm_ratio == null
                    ? '—'
                    : `${l.delta_norm_ratio >= 1 ? '×' : '÷'}${(l.delta_norm_ratio >= 1 ? l.delta_norm_ratio : 1 / l.delta_norm_ratio).toFixed(2)}`}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if obs.history.some((h) => h.weights_ref != null)}
      <p class="dim">
        <Stamp>pesi</Stamp>
        alcuni update hanno tenuto una copia dei pesi: la distanza parametrica
        sopra è calcolata sui tensori reali.
      </p>
    {:else}
      <p class="dim">
        Nessun update ha tenuto i pesi: il confronto resta su statistiche e
        output. Con <code>weight_snapshot_keep &gt; 0</code> in «solo
        statistiche» si ottiene anche la distanza ‖W_a − W_b‖ esatta, al costo
        di ~460 MB per update.
      </p>
    {/if}
  {/if}
</section>
