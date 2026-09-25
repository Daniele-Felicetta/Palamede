<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Led from './Led.svelte'
  import Stamp from './Stamp.svelte'

  export interface PlateStamp { text: string; tone?: 'plain' | 'hot' | 'ok' }

  let {
    name = '',
    led = 'off',
    stamps = [] as PlateStamp[],
    down = '',
    selected = false,
    ...rest
  }: {
    name?: string
    led?: 'on' | 'off' | 'busy'
    stamps?: PlateStamp[]
    down?: string
    selected?: boolean
  } & HTMLButtonAttributes = $props()
</script>

<button
  type="button"
  class={`plate${selected ? ' sel' : ''}`}
  {...rest}
>
  <span class="pname"><Led state={led} />{name}</span>
  {#if stamps.length}
    <span class="pstamps">
      {#each stamps as s (s.text)}<Stamp hot={s.tone === 'hot'} ok={s.tone === 'ok'}>{s.text}</Stamp>{/each}
    </span>
  {/if}
  {#if down}<span class="pdown">{down}</span>{/if}
</button>
