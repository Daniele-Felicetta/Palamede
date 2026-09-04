<script lang="ts">
  let { text, streaming }: { text: string; streaming: boolean } = $props()
  let open = $state(false)
  $effect(() => { if (streaming) open = true })
</script>

<details class="reason" bind:open={open}>
  <summary>ragionamento</summary>
  <div class="reason-text">{text}</div>
</details>
