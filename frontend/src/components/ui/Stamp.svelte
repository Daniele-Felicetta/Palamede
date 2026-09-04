<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    hot = false,
    ok = false,
    children,
    ...rest
  }: {
    hot?: boolean
    ok?: boolean
    children?: Snippet
  } & HTMLAttributes<HTMLSpanElement> = $props()
</script>

<span class={`stamp${hot ? ' hot' : ''}${ok ? ' ok' : ''}`} {...rest}>
  {#if children}
    {@render children()}
  {/if}
</span>
