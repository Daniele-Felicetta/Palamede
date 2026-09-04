<script lang="ts">
  let { data = {} as Record<string, string> }: { data?: Record<string, string> } = $props()
</script>

<table class="spec-table">
  <tbody>
    {#each Object.entries(data) as [k, v] (k)}
      <tr><th>{k}</th><td>{v}</td></tr>
    {/each}
  </tbody>
</table>
