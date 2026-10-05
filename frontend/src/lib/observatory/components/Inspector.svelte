<script lang="ts">
  // Palamede — Osservatorio: l'inspector.
  //
  // Mostra i numeri reali di ciò che è selezionato nella scena 3D: prima il
  // nodo (il layer), poi i suoi moduli, poi i tensori. Nessuna stima, nessun
  // valore "circa": se una misura non esiste, la riga dice che non esiste e
  // perché (per esempio in LoRa le embeddings sono congelate: `measured:false`).

  import { obs } from '../store.svelte'
  import { Button, Hintline, Stamp } from '../../../components/ui'
  import { int, ms, num, pct, shape, sig } from '../format'

  const sel = $derived(obs.selection)

  /**
   * Il nodo che contiene la selezione, qualunque forma abbia.
   *
   * I tre rami sono espliciti invece di una catena ternaria: con `sel` che
   * può essere `null`, il ramo finale ('tensor') non è restringibile e il
   * compilatore lo segnala — meglio che leggere `sel.name` su un selettore
   * nullo e ottenere un errore a runtime.
   */
  function nodeIdOf(sel: typeof obs.selection): string | null {
    if (!sel) return null
    if (sel.kind === 'node') return sel.id
    if (sel.kind === 'module') return obs.nodeIdOfModule(sel.id)
    return obs.nodeIdOfTensor(sel.name)
  }

  const selectedNodeId = $derived(nodeIdOf(sel))
  const nodeStat = $derived(obs.nodeStats.find((n) => n.id === selectedNodeId) ?? null)
  const node = $derived(obs.graph?.nodes.find((n) => n.id === selectedNodeId) ?? null)
  const moduleStat = $derived(
    sel?.kind === 'module' ? obs.moduleStats.find((m) => m.id === sel.id) ?? null : null,
  )
  const tensors = $derived.by(() => {
    if (sel?.kind === 'tensor') return obs.tensorStats.filter((t) => t.name === sel.name)
    if (sel?.kind === 'module') return obs.tensorsOfModule(sel.id)
    return obs.selectedTensors
  })

  /** I tensori con gradiente ma delta azzerato dal formato. */
  const lost = $derived(tensors.filter((t) => t.rounded_away))
  const layerActivation = $derived.by(() => {
    if (!node || node.layer == null || !obs.last?.activations) return null
    return obs.last.activations[String(node.layer)] ?? null
  })

  const sortedTensors = $derived(
    [...tensors].sort((a, b) => b.delta_norm - a.delta_norm),
  )

  /** La barra del tensori è relativa al massimo del gruppo, non assoluta. */
  function barPct(v: number): number {
    const max = Math.max(...tensors.map((x) => x.delta_norm), 1e-12)
    return Math.max(1, (v / max) * 100)
  }

  function cfgLabel(): string {
    return obs.config?.mode === 'LORA' ? 'LoRa' : 'FULL'
  }
</script>

<aside class="obs-inspector" aria-label="Inspector">
  {#if !sel}
    <div class="obs-empty">
      <strong>Nessuna selezione</strong>
      <p>
        Clicca una lastra o un modulo nella scena 3D per vedere i numeri di quel
        gruppo di parametri.
      </p>
      <ul class="obs-tips">
        <li>trascina per orbitare · rotella per lo zoom · tasto destro per il pan</li>
        <li>doppio click su una lastra per entrarci dentro</li>
        <li>un click su un modulo isola il layer che lo contiene</li>
      </ul>
    </div>
  {:else}
    <header class="obs-insp-head">
      <div>
        <span class="obs-insp-kind">
          {#if sel.kind === 'module'}modulo{:else if sel.kind === 'tensor'}tensore{:else}nodo{/if}
        </span>
        <h3>{obs.selectionLabel}</h3>
      </div>
      <div class="obs-insp-actions">
        {#if node}
          <Button
            variant="ghost"
            onclick={() => obs.toggleIsolate(node.id)}
          >
            {obs.isolated === node.id ? 'mostra tutto' : 'isola'}
          </Button>
        {/if}
        <Button variant="ghost" onclick={() => obs.goGlobal()}>chiudi</Button>
      </div>
    </header>

    {#if node && node.params_aliased}
      <p class="obs-alias">
        <Stamp>alias</Stamp>
        questo nodo è lo <strong>stesso tensor</strong> di
        <button class="lnk" onclick={() => obs.selectNode('embeddings')}>Embeddings</button>:
        in LFM2.5 <code>lm_head</code> è tied a <code>embed_tokens</code>. Non è un
        parametro distinto, quindi non viene contato due volte nel totale
        dell'update.
      </p>
    {/if}

    {#if nodeStat && !nodeStat.measured}
      <p class="obs-frozen">
        <Stamp>frozen</Stamp>
        nessun tensore trainabile in questo gruppo con la modalità corrente
        ({cfgLabel()}). In FULL è il peso pieno del modello; in LoRa il modello
        base resta congelato e qui non c'è nulla che si muova.
      </p>
    {/if}

    {#if moduleStat}
      <h4>modulo</h4>
      <dl class="obs-kv">
        <dt>gruppo</dt><dd>{moduleStat.label}</dd>
        <dt>tensori</dt><dd>{moduleStat.tensors}</dd>
        <dt>parametri</dt><dd>{int(moduleStat.params)}</dd>
        {#if moduleStat.measured}
          <dt>gradiente</dt><dd>{num(moduleStat.grad_norm)}</dd>
          <dt>‖w‖ prima</dt><dd>{num(moduleStat.weight_norm_before)}</dd>
          <dt>‖w‖ dopo</dt><dd>{num(moduleStat.weight_norm_after)}</dd>
          <dt>‖δ‖</dt><dd>{num(moduleStat.delta_norm)}</dd>
          <dt>max |δ|</dt><dd>{sig(moduleStat.delta_absmax)}</dd>
          <dt>variazione</dt><dd>{pct(moduleStat.rel_change_pct)}</dd>
          <dt>quota del totale</dt>
          <dd>
            {moduleStat.contribution_pct == null
              ? '—'
              : `${moduleStat.contribution_pct.toFixed(1)}%`}
          </dd>
        {:else}
          <dt>misure</dt><dd>non disponibili (congelato)</dd>
        {/if}
      </dl>
    {/if}

    {#if nodeStat}
      <h4>{moduleStat ? 'layer che lo contiene' : 'layer'}</h4>
      <dl class="obs-kv">
        <dt>parametri</dt><dd>{int(nodeStat.params)}</dd>
        <dt>tensori trainabili</dt><dd>{nodeStat.tensors || '—'}</dd>
        {#if nodeStat.measured}
          <dt>gradiente</dt><dd>{num(nodeStat.grad_norm)}</dd>
          <dt>‖w‖ prima</dt><dd>{num(nodeStat.weight_norm_before)}</dd>
          <dt>‖w‖ dopo</dt><dd>{num(nodeStat.weight_norm_after)}</dd>
          <dt>‖δ‖</dt><dd>{num(nodeStat.delta_norm)}</dd>
          <dt>δ medio assoluto</dt><dd>{sig(nodeStat.delta_mean_abs)}</dd>
          <dt>max |δ|</dt><dd>{sig(nodeStat.delta_absmax)}</dd>
          <dt>variazione relativa</dt><dd>{pct(nodeStat.rel_change_pct)}</dd>
          <dt>quota del totale</dt>
          <dd>
            {nodeStat.contribution_pct == null
              ? '—'
              : `${nodeStat.contribution_pct.toFixed(1)}%`}
          </dd>
        {/if}
      </dl>
    {/if}

    {#if layerActivation}
      <h4>attivazione (uscita reale del layer)</h4>
      <dl class="obs-kv">
        <dt>RMS</dt><dd>{num(layerActivation.rms)}</dd>
        <dt>media</dt><dd>{num(layerActivation.mean)}</dd>
        <dt>deviazione</dt><dd>{num(layerActivation.std)}</dd>
        <dt>max assoluto</dt><dd>{num(layerActivation.absmax)}</dd>
        <dt>forma</dt><dd>{shape(layerActivation.shape)}</dd>
      </dl>
    {/if}

    {#if lost.length}
      <p class="obs-lost">
        <Stamp hot>attenzione</Stamp>
        {lost.length} {lost.length === 1 ? 'tensore ha' : 'tensori hanno'} ricevuto
        gradiente ma il delta è <strong>0</strong>: il formato
        {obs.state?.precision ?? ''} non rappresenta un update così piccolo e
        l'ha arrotondato via. Sono tutti
        {lost.every((t) => t.name.includes('norm')) ? 'RMSNorm' : 'altri'} tensori.
      </p>
    {/if}

    {#if tensors.length}
      <h4>
        tensori
        <span class="dim">({tensors.length}, ordinati da ‖δ‖)</span>
      </h4>
      <div class="obs-tensors">
        {#each sortedTensors as t (t.name)}
          <button
            class="obs-tensor"
            class:on={sel.kind === 'tensor' && sel.name === t.name}
            onclick={() => obs.select({ kind: 'tensor', name: t.name })}
            title="seleziona questo tensore"
          >
            <span class="obs-tn">{t.name.replace(/^model\./, '')}</span>
            <span class="obs-ts">{shape(t.shape)}</span>
            <span class="obs-trow">
              <span title="norma del gradiente">∇ {num(t.grad_norm)}</span>
              <span title="norma del peso">‖w‖ {num(t.weight_norm_before)}</span>
              <span title="norma del delta">‖δ‖ {num(t.delta_norm)}</span>
              <span title="variazione relativa">Δ {pct(t.rel_change_pct)}</span>
            </span>
            <span class="obs-tbar" aria-hidden="true">
              <i style:width={`${barPct(t.delta_norm)}%`}></i>
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if obs.last}
      <h4>quando</h4>
      <dl class="obs-kv">
        <dt>update</dt><dd>#{obs.last.index}</dd>
        <dt>modalità</dt><dd>{obs.last.mode}</dd>
        <dt>step</dt><dd>{obs.last.steps}</dd>
        <dt>perdita</dt>
        <dd>{obs.last.loss_before.toFixed(4)} → {obs.last.loss_after.toFixed(4)}</dd>
        <dt>delta-norm</dt><dd>{num(obs.last.totals.delta_norm)}</dd>
        <dt>gradiente</dt><dd>{num(obs.last.totals.grad_norm)}</dd>
        <dt>tempo</dt><dd>{ms(obs.last.timing.total_ms)}</dd>
      </dl>
      <Hintline>{obs.last.precision_note}</Hintline>
    {/if}
  {/if}
</aside>

