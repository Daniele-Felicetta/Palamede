<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let { state = 'off', ...rest }: { state?: 'on' | 'off' | 'busy' } & HTMLAttributes<HTMLSpanElement> = $props()
</script>

<span class={`led ${state}`} {...rest} aria-hidden="true"></span>
