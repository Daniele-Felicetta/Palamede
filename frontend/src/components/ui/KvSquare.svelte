<script lang="ts">
  // Quadrato della KV cache. Chiuso mostra solo il tipo attivo; aperto mostra
  // le alternative con il loro peso in memoria. Si apre TRAINANDO col mouse
  // l'angolo in basso a destra, in diagonale come un vero quadrato: la
  // diagonale (media dei due assi), non un lato, guida la crescita, così il
  // riquadro resta quadrato a ogni dimensione.
  import { Text } from '../../lib/text'

  let {
    value,
    context = 0,
    onselect,
  }: {
    value: string
    /** contesto attivo: la KV cresce con i token, quindi conta */
    context?: number
    /** assente = quadrato di sola lettura (pagina Server) */
    onselect?: (v: string) => void
  } = $props()

  // chiuso mostra solo il tipo attivo, aperto le alternative. MAX sta dentro
  // la larghezza del pannello impostazioni (460px - padding).
  const MIN = 132
  const MAX = 344

  let size = $state(MIN)
  let drag = $state<{ x: number; y: number; size: number } | null>(null)
  let open = $derived(size > MIN + 24)

  const clamp = (n: number): number => Math.round(Math.min(MAX, Math.max(MIN, n)))

  function grab(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, size }
  }
  function move(e: PointerEvent) {
    if (!drag) return
    size = clamp(drag.size + ((e.clientX - drag.x) + (e.clientY - drag.y)) / 2)
  }
  function keys(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') size = clamp(size - step)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') size = clamp(size + step)
    else if (e.key === 'Home') size = MIN
    else return
    e.preventDefault()
  }
</script>

<div class="kvsq" class:open class:dragging={!!drag} style={`--kvsz:${size}px`}>
  <span class="kvsq-lab">KV cache</span>
  <strong class="kvsq-val">{value}</strong>
  {#if context > 0}
    <span class="kvsq-sub">ctx {context.toLocaleString('it-IT')} · cresce con i token</span>
  {/if}

  {#if open}
    <ul class="kvsq-list">
      {#each Text.KV_OPTIONS as o (o.id)}
        <li>
          <button class="kvsq-opt" type="button" class:on={o.id === value}
            disabled={!onselect} aria-pressed={o.id === value} title={o.hint}
            onclick={() => onselect?.(o.id)}>
            <span>{o.id}</span>
            <span class="kvsq-rel">{Text.kvRel(o.bytes)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <span class="kvsq-hint">trascina l'angolo<br />per aprire</span>
  {/if}

  <button class="kvsq-grip" type="button" aria-label="Ridimensiona il quadrato"
    title="trascina in diagonale · doppio click per richiudere"
    onpointerdown={grab} onpointermove={move} onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)} ondblclick={() => (size = MIN)} onkeydown={keys}></button>
</div>

<style>
  .kvsq {
    position: relative;
    flex: none;
    width: var(--kvsz);
    height: var(--kvsz);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--ink-2);
    padding: 9px 22px 20px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow: hidden;
  }
  .kvsq.dragging { border-color: var(--accent); user-select: none; }

  .kvsq-lab { font: 10px var(--mono); letter-spacing: 1.2px; text-transform: uppercase; color: var(--paper-dim); }
  .kvsq-val { font-family: var(--display); font-size: 23px; font-weight: 600; line-height: 1.1; color: var(--paper); }
  .kvsq.open .kvsq-val { font-size: 18px; }
  .kvsq-sub { font: 10px var(--mono); color: var(--paper-faint); }

  .kvsq-hint { font: 10px var(--mono); line-height: 1.35; color: var(--paper-faint); margin-top: auto; }

  .kvsq-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 3px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .kvsq-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--ink-3);
    color: var(--paper-dim);
    font: 11px var(--mono);
    text-align: left;
  }
  .kvsq-opt:not(:disabled) { cursor: pointer; }
  .kvsq-opt:hover:not(:disabled) { color: var(--paper); border-color: var(--paper-faint); }
  .kvsq-opt.on { border-color: var(--accent); color: var(--paper); }
  .kvsq-rel { color: var(--paper-faint); font-size: 10px; }
  .kvsq-opt.on .kvsq-rel { color: var(--accent); }

  .kvsq-opt:focus-visible, .kvsq-grip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
  .kvsq-grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: none;
    cursor: nwse-resize;
    touch-action: none;
  }
  .kvsq-grip::after {
    content: '';
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--paper-faint);
    border-bottom: 2px solid var(--paper-faint);
  }
  .kvsq-grip:hover::after { border-color: var(--accent); }
</style>