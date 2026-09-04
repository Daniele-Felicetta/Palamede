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
  <input type="file" accept={accept} hidden onchange={onChange} />
  {#if children}
    {@render children()}
  {/if}
</label>
