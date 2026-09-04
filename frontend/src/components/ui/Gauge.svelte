<script lang="ts">
  export interface GaugeCell { num: string; unit?: string; label: string }

  let { cells = [] as GaugeCell[] }: { cells?: GaugeCell[] } = $props()
</script>

<div class="gauge">
  {#each cells as c (c.label)}
    <div class="cell">
      <div class="num">{c.num}{#if c.unit}<small> {c.unit}</small>{/if}</div>
      <div class="lab">{c.label}</div>
    </div>
  {/each}
</div>
