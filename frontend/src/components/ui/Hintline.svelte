<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    err = false,
    cls = '',
    children,
    ...rest
  }: {
    err?: boolean
    cls?: string
    children?: Snippet
  } & HTMLAttributes<HTMLParagraphElement> = $props()
</script>

<p class={`hintline${err ? ' err' : ''}${cls ? ' ' + cls : ''}`} role="status" {...rest}>
  {#if children}
    {@render children()}
  {/if}
</p>
