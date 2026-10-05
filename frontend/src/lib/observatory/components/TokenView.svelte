<script lang="ts">
  // Palamede — Osservatorio: la Token View.
  //
  // Collega il comportamento ai token, usando solo numeri reali:
  //   · la loss per posizione, dal log-softmax dei logits veri
  //   · la norma del vettore hidden per posizione, dall'uscita agganciata
  //     all'ultimo layer
  //   · l'entropia di quegli hidden (derivata, non il softmax dei logits)
  //   · le mappe di attenzione QK, mediate sulle 16 teste e dichiarate
  //
  // Niente qui è interpolato o inventato: se un valore non c'è, la cella
  // resta vuota invece di essere riempita con uno zero che sembrerebbe una
  // misura.

  import { obs } from '../store.svelte'
  import { num, token as tokText } from '../format'

  const last = $derived(obs.last)
  const rows = $derived(last?.per_token?.rows ?? [])
  const attn = $derived(last?.attention?.layers ?? {})
  const attnLayers = $derived(Object.keys(attn).sort((a, b) => Number(a) - Number(b)))
  const sel = $derived(obs.attentionLayer ?? attnLayers[0] ?? null)
  const matrix = $derived(sel != null ? attn[sel]?.matrix ?? null : null)
  const heads = $derived(sel != null ? attn[sel]?.heads ?? 0 : 0)

  /** Il token selezionato, per il riquadro di dettaglio. */
  const selRow = $derived(obs.tokenIndex != null ? rows[obs.tokenIndex] ?? null : null)
  const selAttn = $derived.by(() => {
    if (!matrix || obs.tokenIndex == null) return null
    return matrix[obs.tokenIndex] ?? null
  })

  function maxNorm(): number {
    return Math.max(...rows.map((r) => r.norm ?? 0), 1e-9)
  }
  function normPct(v: number | null): number {
    return v == null ? 0 : (v / maxNorm()) * 100
  }
  function maxEnt(): number {
    return Math.max(...rows.map((r) => r.entropy ?? 0), 1e-9)
  }
  function entPct(v: number | null): number {
    return v == null ? 0 : (v / maxEnt()) * 100
  }
  /** Colormap divergente sulla riga di attenzione: freddo → caldo. */
  function heat(v: number): string {
    const t = Math.min(1, Math.max(0, v))
    const r = Math.round(20 + t * 235)
    const g = Math.round(30 + t * 80)
    const b = Math.round(90 - t * 60)
    return `rgb(${r},${g},${b})`
  }
</script>

<section class="obs-tokens" aria-label="Token view">
  {#if !last || !rows.length}
    <div class="obs-empty">
      <strong>Nessun token misurato</strong>
      <p>Allenare un esempio per vedere la perdita e le attivazioni per token.</p>
    </div>
  {:else}
    <h4>
      token
      <span class="dim">
        {rows.length} posizioni · {last.n_target} sul target
      </span>
    </h4>

    <div class="obs-tokrow">
      {#each rows as r (r.i)}
        <div class="obs-tok-wrap">
          <button
            class="obs-tok"
            class:target={r.is_target}
            class:on={obs.tokenIndex === r.i}
            onclick={() => (obs.tokenIndex = obs.tokenIndex === r.i ? null : r.i)}
            title="posizione {r.i} · id {r.id}"
          >
            <span class="obs-tok-t">{tokText(r.text)}</span>
            <span class="obs-tok-metrics">
              <i class="obs-m-norm" style:height={`${Math.max(3, normPct(r.norm))}%`}></i>
              <i class="obs-m-ent" style:height={`${Math.max(3, entPct(r.entropy))}%`}></i>
            </span>
            <span class="obs-tok-v">
              {#if r.norm != null}‖{num(r.norm, 2)}{:else}—{/if}
            </span>
          </button>
        </div>
      {/each}
    </div>

    <p class="obs-toklegend">
      <span><i class="obs-m-norm"></i>norma hidden</span>
      <span><i class="obs-m-ent"></i>entropia</span>
      <span class="dim">
        dal layer {last.per_token?.last_layer ?? '—'} · {last.per_token?.note ?? ''}
      </span>
    </p>

    {#if selRow}
      <div class="obs-tokdet">
        <strong>posizione {selRow.i}</strong>
        <code>{tokText(selRow.text)}</code>
        <span class="dim">id {selRow.id}</span>
        {#if selRow.is_target}<span class="obs-badge">target</span>{/if}
        <dl class="obs-kv">
          <dt>norma hidden</dt><dd>{selRow.norm == null ? '—' : num(selRow.norm)}</dd>
          <dt>entropia</dt><dd>{selRow.entropy == null ? '—' : num(selRow.entropy)}</dd>
          {#if selAttn}
            <dt>attenzione massima</dt>
            <dd>{num(Math.max(...selAttn))}</dd>
            <dt>su</dt>
            <dd>
              <code>{tokText(rows[selAttn.indexOf(Math.max(...selAttn))]?.text ?? '')}</code>
            </dd>
          {/if}
        </dl>
      </div>
    {/if}

    {#if attnLayers.length}
      <h4>
        attenzione
        <span class="dim">vera QK, media su {heads} teste</span>
      </h4>
      <div class="obs-attn-layers">
        {#each attnLayers as l (l)}
          <button
            class="obs-attn-tab"
            class:on={sel === l}
            onclick={() => (obs.attentionLayer = l)}
          >
            L{l}
          </button>
        {/each}
      </div>
      {#if matrix}
        <div class="obs-attn">
          {#each matrix as row, qi (qi)}
            <div class="obs-attn-row">
              <span class="obs-attn-q">{tokText(rows[qi]?.text ?? '')}</span>
              {#each row as v, ki (ki)}
                <span
                  class="obs-attn-c"
                  style:background={heat(v)}
                  title={`query ${qi} → key ${ki}: ${v.toFixed(4)}`}
                ></span>
              {/each}
            </div>
          {/each}
        </div>
        <p class="obs-attn-keys">
          {#each rows as r, i (i)}
            <span title="chiave {i}">{tokText(r.text)}</span>
          {/each}
        </p>
        <p class="dim">
          {last.attention?.reduction ?? ''} — ogni riga somma a 1 (verificato nei
          test). Non è un'immagine generata: sono i prodotti Q·K dei tensori del
          checkpoint.
        </p>
      {/if}
    {:else}
      <p class="dim">
        Le mappe di attenzione non sono state catturate (impostazione
        <code>collect_attention</code> spenta, oppure il modello sta usando
        <code>sdpa</code>, che le rifiuta).
      </p>
    {/if}
  {/if}
</section>
