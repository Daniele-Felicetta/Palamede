<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children, cls = '' }: { children?: Snippet; cls?: string } = $props()
</script>

<div class={`empty${cls ? ' ' + cls : ''}`}>
  {#if children}
    {@render children()}
  {/if}
</div>
