<script lang="ts">
  import type { Snippet } from 'svelte'
  import SectionHead from './SectionHead.svelte'

  let {
    eyebrow = '',
    title,
    actions,
  }: { eyebrow?: string; title: string; actions?: Snippet } = $props()
</script>

<div class="hist-head">
  <SectionHead eyebrow={eyebrow} title={title} />
  {#if actions}
    <div class="hist-actions">{@render actions()}</div>
  {/if}
</div>
