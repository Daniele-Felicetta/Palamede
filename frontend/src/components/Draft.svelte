<script lang="ts">
  import type { DraftWiki } from '../data/wiki'
  import { Eyebrow, SpecTable } from './ui'

  // Pagina-bozza: wiki del tipo di modello + cosa serve per accenderla.
  let { draft }: { draft: DraftWiki } = $props()
</script>

<Eyebrow>Sezione {draft.glyph} · bozza</Eyebrow>
<h1>{draft.title}</h1>
<p class="lede">{draft.tagline}</p>

<div class="bozza-note">
  <strong>Stato:</strong> {draft.specs['Stato']}
</div>

<section class="wiki" style="margin-top: 34px">
  <article class="wiki-entry">
    <h3>Come funziona <span class="tag">{draft.glyph}</span></h3>
    <div class="wiki-body">
      {#each draft.how as p, i (i)}<p>{p}</p>{/each}
    </div>

    <SpecTable data={draft.specs} />

    <h3 style="margin-top: 28px">Cosa manca per accenderla</h3>
    <div class="wiki-body">
      {#each draft.needs as n (n)}<p>— {n}</p>{/each}
    </div>
  </article>
</section>
