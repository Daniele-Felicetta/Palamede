<script lang="ts">
  import { sxToString } from "../../utils/sxToString";
  import { type Snippet } from "svelte";
  import { scale } from "svelte/transition";

  let x = $state(0);
  let y = $state(0);
  let visible = $state(false);

  type TooltipProps = {
    readonly children: Snippet;
    readonly title: string;
    readonly hide?: boolean;
    readonly sx?: object;
  };

  const { children, title, hide, sx }: TooltipProps = $props();

  function handleMouseMove(event: MouseEvent) {
    x = event.clientX + 10; // Offset from cursor
    y = event.clientY + 10;
  }

  function showTooltip() {
    visible = true;
  }

  function hideTooltip() {
    visible = false;
  }
</script>

<div class="tooltip-wrapper">
  <div
    class="tooltip-container"
    onmousemove={handleMouseMove}
    onmouseenter={showTooltip}
    onmouseleave={hideTooltip}
    role="tooltip"
    tabindex="-1"
  >
    {@render children()}
    {#if visible && !hide}
      <div
        class="tooltip visible"
        style={`${sxToString(sx)}; left: ${x}px; top: ${y}px;`}
        transition:scale={{ duration: 150 }}
      >
        {title}
      </div>
    {/if}
  </div>
</div>

<style>
  .tooltip-wrapper {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  .tooltip-container {
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }
  .tooltip {
    position: fixed;
    background-color: #333;
    color: #fff;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    word-break: break-all;
    word-wrap: break-word;
    width: "auto";
    transform: translate(-50%, 50%);
    z-index: 99999;
  }

  .tooltip.visible {
    opacity: 1;
  }

  /* @media (max-width: 768px) {
    .tooltip {
      display: none;
    }
  } */
</style>
