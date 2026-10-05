<script lang="ts">
  // Palamede — Osservatorio: la legenda dei mapping visivi.
  //
  // Viene dal backend (`LEGEND` in `server.py`), non è scritta qui: se la
  // scala di un canale cambia lato Python, la legenda cambia con lei e non
  // può restare quella vecchia a mentire. Sotto c'è la regola che vale per
  // tutto: un colore che non è nella legenda è un colore che non significa
  // niente.

  import { obs } from '../store.svelte'
  import { int } from '../format'
</script>

<details class="obs-legend">
  <summary>
    legenda
    <span class="dim">cosa significa ogni segnale</span>
  </summary>

  <table class="obs-legtab">
    <thead>
      <tr>
        <th>segnale</th>
        <th>cosa misura</th>
        <th>come è scalato</th>
      </tr>
    </thead>
    <tbody>
      {#each obs.legend as l (l.channel)}
        <tr>
          <th scope="row">{l.channel}</th>
          <td>{l.measures}</td>
          <td class="dim">{l.scale}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if obs.disclaimer}
    <p class="obs-disc">{obs.disclaimer}</p>
  {/if}

  {#if obs.graph && obs.graph.unclassified.length}
    <p class="obs-disc">
      <strong>Attenzione:</strong>
      {obs.graph.unclassified.length} tensori non sono stati classificati in
      nessun gruppo: <code>{obs.graph.unclassified.slice(0, 4).join(', ')}</code>.
      Non vengono mostrati, e questo è dichiarato per non far sembrare completa
      una copertura che non lo è.
    </p>
  {/if}

  {#if obs.model}
    <p class="obs-disc dim">
      Checkpoint <code>{obs.model.checkpoint}</code> · attenzione
      <code>{obs.model.attn_implementation}</code> · pesi master
      <code>{obs.model.master_dtype}</code> · calcolo
      <code>{obs.model.compute_dtype}</code> · {int(obs.model.tensors)} tensori.
    </p>
  {/if}
</details>
