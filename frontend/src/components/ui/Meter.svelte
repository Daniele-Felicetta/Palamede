<script lang="ts">
  let {
    label = '',
    value = 0,
    max = 100,
    unit = '',
  }: { label?: string; value?: number; max?: number; unit?: string } = $props()

  const pct = $derived(max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0)
</script>

<div class="meter">
  <div class="meter-top">
    <span class="meter-lab">{label}</span>
    <span class="meter-val">{value.toFixed(1)}{unit}</span>
  </div>
  <div class="meter-bar"><span class="meter-fill" style:width="{pct}%"></span></div>
</div>
