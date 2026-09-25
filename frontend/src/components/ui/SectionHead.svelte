<script lang="ts">
  import type { Snippet } from 'svelte'
  import Eyebrow from './Eyebrow.svelte'

  let {
    eyebrow = '',
    title,
    sub,
    level = 2,
  }: { eyebrow?: string; title: string; sub?: string | Snippet; level?: 2 | 3 } = $props()
</script>

<div>
  {#if eyebrow}<Eyebrow>{eyebrow}</Eyebrow>{/if}
  {#if level === 3}
    <h3 class="sec-title sec-title-sub">{title}</h3>
  {:else}
    <h2 class="sec-title">{title}</h2>
  {/if}
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
