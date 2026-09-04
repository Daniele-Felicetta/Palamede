<script lang="ts">
  import type { ModelWiki } from '../data/wiki'
  import { SpecTable } from './ui'

  // Voce wiki di un modello: funzionamento, tabella specifiche, qualità,
  // esempi reali generati dal modello stesso.
  let { model }: { model: ModelWiki } = $props()
</script>

<article class="wiki-entry" id={`wiki-${model.id}`}>
  <h3>
    {model.name} <span class="tag">{model.family}</span>
  </h3>
  <div class="wiki-body">
    {#each model.how as p, i (i)}<p>{p}</p>{/each}
  </div>

  <SpecTable data={model.specs} />

  <div class="wiki-body" style="margin-top: 16px">
    {#each model.quality as p, i (i)}<p>— {p}</p>{/each}
  </div>

  <div class="ex-row">
    {#each model.examples as ex (ex.file)}
      <figure class="ex">
        <img src={`examples/${ex.file}`} alt={ex.prompt} loading="lazy" />
        <figcaption class="cap">
          “{ex.prompt}”
          <span class="m">{ex.note}</span>
        </figcaption>
      </figure>
    {/each}
  </div>
</article>
