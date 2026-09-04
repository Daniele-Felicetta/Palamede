<script lang="ts">
  import type { Snippet } from 'svelte'
  import Eyebrow from './Eyebrow.svelte'

  let {
    eyebrow = '',
    title,
    sub,
  }: { eyebrow?: string; title: string; sub?: string | Snippet } = $props()
</script>

<div>
  {#if eyebrow}<Eyebrow>{eyebrow}</Eyebrow>{/if}
  <h2 class="sec-title">{title}</h2>
  {#if sub}
    <p class="sec-sub">
      {#if typeof sub === 'string'}
        {sub}
      {:else}
        {@render sub()}
      {/if}
    </p>
  {/if}
</div>
