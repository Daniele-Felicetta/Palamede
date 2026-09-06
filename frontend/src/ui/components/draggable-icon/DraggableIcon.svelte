<script lang="ts">
  import type { Snippet } from "svelte";
  import IconButton from "../icon-button/IconButton.svelte";
  import { scale } from "svelte/transition";

  type DraggableProps = {
    children?: Snippet;
    icon: string;
    top: number;
    left: number;
    onClick: () => void;
    isDragging?: boolean;
    size?: number;
  };

  let {
    children,
    icon,
    onClick,
    top = $bindable(),
    left = $bindable(),
    isDragging = $bindable(),
    size,
  }: DraggableProps = $props();

  let isHide = $state(true);
  let action: null | string = $state(null);

  function onMouseDown() {
    action = "move";
    isDragging = false;
  }

  function onMouseMove(event: any) {
    if (action === "move") {
      left += event.movementX;
      top += event.movementY;
      isDragging = true;
    }
  }

  function onMouseUp() {
    action = null;
    isDragging = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if isHide}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    onmousedown={onMouseDown}
    style={`
        left: ${left}px; 
        top: ${top}px; 
        `}
    class="draggable"
    onclick={onClick}
    in:scale={{ duration: 10 }}
    out:scale={{ duration: 150 }}
  >
    {#if !isDragging}
      <IconButton src={icon} title="" hideTooltip {size} />
      {children}
    {/if}
  </div>
{/if}

<svelte:window onmouseup={onMouseUp} onmousemove={onMouseMove} />

<style>
  .draggable {
    user-select: none;
    cursor: move;
    border: solid 1px gray;
    position: absolute;
    border-radius: 0.2rem;
    padding: 0.5rem;
    overflow: none;
    background-color: color-mix(in srgb, var(--primary-color), transparent 20%);
  }
</style>
