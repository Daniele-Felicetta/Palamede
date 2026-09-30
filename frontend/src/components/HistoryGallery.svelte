<script lang="ts">
  // Galleria della cronologia immagini: griglia + svuota + lightbox con
  // navigazione. La pagina Images resta l'orchestratore (generazione, modelli,
  // img2img): qui solo presentazione della cronologia persistita.
  import type { HistoryEntry } from '../api'
  import { historyImgUrl } from '../api'
  import { Images } from '../lib/images'
  import Shot from './Shot.svelte'
  import { Button, EmptyState, HistHead, Lightbox } from './ui'

  let {
    history,
    clearing = false,
    deleting = null,
    busy = false,
    onwipe,
    onreuse,
    oncopy,
    onremove,
  }: {
    history: HistoryEntry[]
    clearing?: boolean
    deleting?: string | null
    busy?: boolean
    onwipe: () => void
    onreuse: (s: HistoryEntry) => void
    oncopy: (s: HistoryEntry) => void
    onremove: (id: string) => void
  } = $props()

  // Lightbox a schermo pieno (in Tauri target=_blank non funziona): stato
  // interno, la pagina non deve sapere quale immagine è aperta.
  let viewer = $state<string | null>(null)
  const fullIdx = $derived(history.findIndex((s) => s.id === viewer))
  const viewerEntry = $derived(fullIdx >= 0 ? history[fullIdx] : null)
  const prevEntry = $derived(fullIdx > 0 ? history[fullIdx - 1] : null)
  const nextEntry = $derived(
    fullIdx >= 0 && fullIdx < history.length - 1 ? history[fullIdx + 1] : null,
  )
</script>

<section class="hist" aria-label="Cronologia">
  <HistHead eyebrow="Cronologia" title="Ultime generazioni">
    {#snippet actions()}
      {#if history.length > 0}
        <Button variant="side" onclick={onwipe} disabled={clearing}>
          {clearing ? 'svuoto…' : `svuota (${history.length})`}
        </Button>
      {/if}
    {/snippet}
  </HistHead>

  {#if history.length === 0}
    <EmptyState>
      Nessuna generazione salvata.<br />Genera un'immagine: finisce qui,
      persistente tra una sessione e l'altra.
    </EmptyState>
  {:else}
    <div class="gallery">
      {#each history as s (s.id)}
        <Shot
          src={historyImgUrl(s.id)}
          alt={s.prompt}
          title={s.prompt}
          model={Images.modelName(s.model)}
          size={s.size}
          timeMs={s.timeMs}
          seed={s.seed}
          steps={s.steps}
          deleting={deleting === s.id}
          disabled={!!deleting || busy}
          onopen={() => (viewer = s.id)}
          onreuse={() => onreuse(s)}
          oncopy={() => oncopy(s)}
          onremove={() => onremove(s.id)}
        />
      {/each}
    </div>
  {/if}
</section>

{#if viewer}
  <Lightbox
    open={!!viewerEntry}
    src={viewerEntry ? historyImgUrl(viewerEntry.id) : ''}
    alt={viewerEntry?.prompt ?? ''}
    caption={viewerEntry
      ? `${Images.modelName(viewerEntry.model)} · ${viewerEntry.size} · ${(viewerEntry.timeMs / 1000).toFixed(1)} s · seed ${viewerEntry.seed}`
      : ''}
    index={fullIdx}
    total={history.length}
    onclose={() => (viewer = null)}
    onprev={prevEntry ? () => { if (prevEntry) viewer = prevEntry.id } : undefined}
    onnext={nextEntry ? () => { if (nextEntry) viewer = nextEntry.id } : undefined}
  />
{/if}
