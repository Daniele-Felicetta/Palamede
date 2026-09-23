<script lang="ts">
  import { readKbFile } from '../api'
  import { renderHighlighted } from '../lib/rag'

  // Mostra una fonte raw/ con il chunk [start,end) evidenziato. Usato da
  // Rag.svelte (pannello destro) e Chat.svelte (modale dopo un click su [n]).
  let {
    path,
    start,
    end,
  }: {
    path: string
    start?: number
    end?: number
  } = $props()

  let content = $state<string | null>(null)
  let err = $state('')

  $effect(() => {
    const p = path
    content = null
    err = ''
    readKbFile(p)
      .then((r) => (content = r.content))
      .catch((e) => (err = e instanceof Error ? e.message : String(e)))
  })
</script>

<div class="src-view">
  {#if err}
    <p class="src-view-err">{err}</p>
  {:else if content === null}
    <p class="src-view-load">caricamento…</p>
  {:else if start !== undefined && end !== undefined}
    <div class="src-view-hit" aria-label="passaggio citato">
      {@html renderHighlighted(content, start, end)}
    </div>
  {:else}
    <pre class="src-view-plain">{content}</pre>
  {/if}
</div>

<style>
  .src-view-hit {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12.5px;
    line-height: 1.55;
  }
  .src-view-plain {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.5;
    color: var(--paper-dim);
  }
  .src-view-load,
  .src-view-err {
    font-size: 12px;
    color: var(--paper-faint);
    margin: 0;
  }
  .src-view-err { color: var(--seal); }
</style>