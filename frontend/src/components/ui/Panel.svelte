<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    as = 'section',
    children,
    cls = '',
    ...rest
  }: {
    as?: 'section' | 'div' | 'form'
    children?: Snippet
    cls?: string
  } & HTMLAttributes<HTMLElement> = $props()
</script>

<svelte:element this={as} class={`panel${cls ? ' ' + cls : ''}`} {...rest}>
  {#if children}
    {@render children()}
  {/if}
</svelte:element>
