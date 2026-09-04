<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Led from './Led.svelte'

  let {
    state = 'off',
    led = 'off',
    children,
    ...rest
  }: {
    state?: 'on' | 'off' | 'busy'
    led?: 'on' | 'off' | 'busy'
    children?: Snippet
  } & HTMLAttributes<HTMLSpanElement> = $props()
</script>

<span class={`chat-state${state === 'on' ? ' on' : ''}${state === 'busy' ? ' busy' : ''}`} {...rest}>
  <Led state={led} />
  {#if children}
    {@render children()}
  {/if}
</span>
