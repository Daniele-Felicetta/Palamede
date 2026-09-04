<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet } = $props()
</script>

<p class="eyebrow">
  {#if children}
    {@render children()}
  {/if}
</p>
