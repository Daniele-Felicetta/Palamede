<script lang="ts">
  import visibilityIcon from "../../../../assets/draggable/visibility.svg?url";
  import visibilityOffIcon from "../../../../assets/draggable/visibility-off.svg?url";
  import lockIcon from "../../../../assets/draggable/lock.svg?url";
  import unlockIcon from "../../../../assets/draggable/unlock.svg?url";

  import type { Snippet } from "svelte";
  import DraggableIcon from "../draggable-icon/DraggableIcon.svelte";
    import { scale } from "svelte/transition";

  type DraggableProps = {
    children: Snippet;
  };

  let { children }: DraggableProps = $props();
  let left = $state(0);
  let top = $state(0);
  let width = $state(150);
  let height = $state(150);
  let isHide = $state(false);
  let action: null | string = $state(null);
  let isDragging = $state(false);
  let isLocked = $state(false);

  let resizePositionTop = $derived(top + height - 15);
  let resizePositionLeft = $derived(left + width - 15);
  let hidePositionLeft = $derived(left + width - 42);

  function onMouseDown() {
    action = "move";
  }

  function onMouseMove(event:any) {
    if (action === "move" && !isLocked) {
      left += event.movementX;
      top += event.movementY;
    } else if (action === "resize") {
      if (width >= 500) {
        width = 500;
      }
      if (height >= 500) {
        height = 500;
      }
      if (width <= 150) {
        width = 150;
      }
      if (height <= 150) {
        height = 150;
      }
      setTimeout(() => {
        width += event.movementX;
        height += event.movementY;
      });
    }
  }

  function onMouseUp() {
    action = null;
  }

  function onResizeMouseDown(event:any) {
    action = "resize";
    event.preventDefault();
    event.stopPropagation(); // Evita interferenze con il drag
  }

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->

{#if !isHide}
  <div
    onmousedown={onMouseDown}
    transition:scale={{ duration: 150 }}
    style={`
        left: ${left}px; 
        top: ${top}px; 
        width: ${width !== 0 ? `${width}px` : "auto"}; 
        height: ${height !== 0 ? `${height}px` : "auto"};
        cursor: ${isLocked ? "default" : "move"};
        user-select: ${isLocked ? "auto" : "none"};
        `}
    class="draggable scroll"
  >
    {@render children()}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore element_invalid_self_closing_tag -->
  <div
    transition:scale={{ duration: 150 }}
    onmousedown={onResizeMouseDown}
    style={`
      top: ${resizePositionTop}px; 
      left: ${resizePositionLeft}px; 
      `}
    class="resizer"
  />
  <div
    class="top-icons"
    style={`
      top: ${top}px; 
      left: ${hidePositionLeft}px; 
      `}
    transition:scale={{ duration: 150 }}
  >
    <div class="icon" onclick={() => (isLocked = !isLocked)}>
      <img
        width="20"
        height="20"
        src={isLocked ? lockIcon : unlockIcon}
        alt="visibility"
      />
    </div>
    <div
      class="icon"
      onclick={() => {
        isHide = !isHide;
      }}
    >
      <img width="20" height="20" src={visibilityOffIcon} alt="visibility" />
    </div>
  </div>
{/if}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->

{#if isHide}
  <DraggableIcon
    icon={visibilityIcon}
    bind:top
    bind:left
    {isDragging}
    onClick={() => {
      isHide = false;
    }}
    size={1}
  />
{/if}

<svelte:window onmouseup={onMouseUp} onmousemove={onMouseMove} />

<style>
  .draggable {
    border: solid 1px gray;
    position: absolute;
    width: 200px;
    border-radius: 0.2rem;
    padding: 0.5rem;
    overflow: scroll;
    word-wrap: break-word;
    background-color: color-mix(in srgb, var(--primary-color), transparent 20%);
    overflow: auto;
  }
  .resizer {
    width: 15px;
    height: 15px;
    background-image: repeating-linear-gradient(
      to bottom right,
      var(--primary-color) 1px,
      #555 2px
    );
    outline: 2rem;
    border-radius: 0.2rem;
    position: absolute;
    cursor: nwse-resize;
    opacity: 0.8;
  }
  .top-icons {
    display: flex;
    gap: 2px;
    width: 20px;
    height: 20px;
    position: absolute;
    cursor: pointer;
    outline: 2rem;
    border-radius: 0.2rem;
    opacity: 0.8;
  }
  .icon {
    background-image: repeating-linear-gradient(
      to bottom right,
      var(--primary-color) 1px,
      #555 2px
    );
    border-radius: 1px;
  }
</style>
