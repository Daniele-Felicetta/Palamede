<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    variant = 'go',
    toggled = false,
    cls = '',
    type = 'button',
    children,
    ...rest
  }: {
    variant?: 'go' | 'ghost' | 'side' | 'server'
    toggled?: boolean
    cls?: string
    children?: Snippet
  } & HTMLButtonAttributes = $props()

  const klass = $derived(
    [
      variant === 'go' ? 'go' : '',
      variant === 'ghost' ? 'go ghost' : '',
      variant === 'side' ? 'side-toggle' : '',
      variant === 'server' ? 'srv-btn' : '',
      toggled ? 'on' : '',
      cls,
    ].filter(Boolean).join(' '),
  )
</script>

<button class={klass} type={type} {...rest}>
  {#if children}
    {@render children()}
  {/if}
</button>
