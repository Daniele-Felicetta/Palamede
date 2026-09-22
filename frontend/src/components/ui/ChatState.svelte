<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Led from './Led.svelte'

  let {
    state = 'off',
    led,
    children,
    ...rest
  }: {
    state?: 'on' | 'off' | 'busy'
    led?: 'on' | 'off' | 'busy'
    children?: Snippet
  } & HTMLAttributes<HTMLSpanElement> = $props()

  // Il LED segue `state` a meno che non venga passato un `led` esplicito:
  // i chiamanti usano solo `state`, quindi senza questo il pallino resterebbe
  // sempre spento mentre il testo dice "pronto".
  const dot = $derived(led ?? state)
</script>

<span class={`chat-state${state === 'on' ? ' on' : ''}${state === 'busy' ? ' busy' : ''}`} {...rest}>
  <Led state={dot} />
  {#if children}
    {@render children()}
  {/if}
</span>
