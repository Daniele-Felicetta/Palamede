<script lang="ts">
  export interface TabItem { id: string; label: string }

  let {
    items = [] as TabItem[],
    active = '',
    onselect,
  }: { items?: TabItem[]; active?: string; onselect: (id: string) => void } = $props()
</script>

<div class="doc-tabs">
  {#each items as it (it.id)}
    <button type="button" class={`doc-tab${it.id === active ? ' on' : ''}`} onclick={() => onselect(it.id)}>{it.label}</button>
  {/each}
</div>
