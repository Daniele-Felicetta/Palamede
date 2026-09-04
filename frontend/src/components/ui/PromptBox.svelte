<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    value = $bindable(''),
    cls = '',
    placeholder = '',
    ariaLabel = '',
    ...rest
  }: {
    value?: string
    cls?: string
    placeholder?: string
    ariaLabel?: string
  } & HTMLAttributes<HTMLTextAreaElement> = $props()
</script>

<textarea
  class={`prompt-box${cls ? ' ' + cls : ''}`}
  bind:value
  {placeholder}
  aria-label={ariaLabel}
  {...rest}
></textarea>
