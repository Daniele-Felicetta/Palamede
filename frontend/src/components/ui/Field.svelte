<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    label = '',
    for: forId,
    check = false,
    children,
    ...rest
  }: {
    label?: string
    for?: string
    check?: boolean
    children?: Snippet
  } & HTMLAttributes<HTMLElement> = $props()
</script>

{#if check}
  <label class="field check" {...rest}>
    {#if children}
      {@render children()}
    {/if}
  </label>
{:else}
  <div class="field" {...rest}>
    {#if label}<label for={forId}>{label}</label>{/if}
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}
