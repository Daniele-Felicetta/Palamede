<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements'

  let {
    live = false,
    glyph = '',
    title = '',
    foot = '',
    href = '#',
    ...rest
  }: {
    live?: boolean
    glyph?: string
    title?: string
    foot?: string
    href?: string
  } & HTMLAnchorAttributes = $props()
</script>

<a class={`card${live ? ' live-card' : ''}`} href={href} {...rest}>
  <span class={`state ${live ? 'live' : 'bozza'}`}>{live ? 'attiva' : 'bozza'}</span>
  <span class="glyph">{glyph}</span>
  <h3>{title}</h3>
  <span class="app-foot">{foot}</span>
</a>
