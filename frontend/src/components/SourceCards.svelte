<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { KbChunkHit } from '../api'

  // Card delle fonti citate in una risposta grounded (stile NotebookLM):
  // una per fonte citata, con i numeri di citazione [n] collegati. Il click
  // risale al chiamante (onopen) con la prima occorrenza della fonte.
  let {
    items,
    onopen,
    children,
  }: {
    items: { n: number; chunk: KbChunkHit }[]
    onopen?: (chunk: KbChunkHit) => void
    children?: Snippet
  } = $props()

  // raggruppa per fonte, ordinando per la prima citazione incontrata
  const grouped = $derived(() => {
    const map = new Map<string, { source: string; nums: number[]; chunk: KbChunkHit }>()
    for (const it of items) {
      const g = map.get(it.chunk.source)
      if (g) { if (!g.nums.includes(it.n)) g.nums.push(it.n) }
      else map.set(it.chunk.source, { source: it.chunk.source, nums: [it.n], chunk: it.chunk })
    }
    return [...map.values()]
  })
</script>

<div class="src-cards">
  {#if children}{@render children()}{/if}
  {#each grouped() as g (g.source)}
    <button type="button" class="src-card" onclick={() => onopen?.(g.chunk)}>
      <span class="src-card-file">{g.source}</span>
      {#if g.chunk.section}<span class="src-card-sec">{g.chunk.section}</span>{/if}
      <span class="src-card-cites">{g.nums.map((n) => `[${n}]`).join(' ')}</span>
    </button>
  {/each}
</div>

<style>
  .src-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .src-card {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--line);
    background: var(--ink-3);
    color: var(--paper);
    border-radius: var(--radius-sm);
    padding: 5px 9px;
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    max-width: 100%;
  }
  .src-card:hover { border-color: var(--ochre); }
  .src-card-file { font-family: var(--mono); color: var(--ochre); }
  .src-card-sec { color: var(--paper-faint); }
  .src-card-cites { color: var(--amber); font-family: var(--mono); margin-left: auto; }
</style>