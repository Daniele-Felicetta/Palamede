<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    onfile,
    accept = 'image/*',
    children,
  }: { onfile: (f: File) => void; accept?: string; children?: Snippet } = $props()

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f) onfile(f)
  }
  const onChange = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement
    const f = el.files?.[0]
    if (f) onfile(f)
    el.value = ''
  }
</script>

<label class="dropzone" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  <!-- Visually hidden, NON `hidden`: un input display:none non è focusabile da
       tastiera. Con questa classe resta raggiungibile con Tab e il <label>
       mostra lo stato focus (vedi .dropzone:focus-within in images.css). -->
  <input type="file" class="dz-input" accept={accept} onchange={onChange} />
  {#if children}
    {@render children()}
  {/if}
</label>

<style>
  .dz-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
