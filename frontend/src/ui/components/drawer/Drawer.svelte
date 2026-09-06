<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import { slide, type SlideParams } from "svelte/transition";
  import Button from "../button/Button.svelte";
  import IconButton from "../icon-button/IconButton.svelte";
  import CloseButton from "../close-button/CloseButton.svelte";

  type DrawerProps = {
    readonly isOpenDrawer: boolean;
    readonly anchor?: "left" | "right";
    readonly onCloseDrawer?: () => void;
    readonly onOpenDrawer?: () => void;
    readonly header?: Snippet;
    readonly children?: Snippet;
    readonly notDestroy?: boolean;
    readonly width?: String;
    readonly height?: String;
    readonly backgroundColor?: String;
    readonly outline?: String;
    readonly style?: String;
    readonly animation?: SlideParams;
    readonly closeButton?: boolean;
  };

  let {
    isOpenDrawer = $bindable(),
    onCloseDrawer,
    onOpenDrawer,
    anchor = "right",
    children,
    header,
    notDestroy,
    width,
    height,
    backgroundColor,
    outline,
    style,
    animation,
    closeButton,
  }: DrawerProps = $props();

  let drawer: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (!document) return;

    document.body.onmousedown = (e) => {
      if (!isOpenDrawer || !drawer) return;

      onOpenDrawer?.();

      const mouseX = e.x;
      const mouseY = e.y;
      let windowDimensions = drawer?.getBoundingClientRect();

      if (!windowDimensions) return;
      let overWidth =
        mouseX < windowDimensions?.x ||
        mouseX > windowDimensions.x + windowDimensions.width;

      let overHeight =
        mouseY < windowDimensions.y ||
        mouseY > windowDimensions.y + windowDimensions.height;

      if (overWidth || overHeight) {
        if (!notDestroy) {
          drawer = null;
          setTimeout(() => {
            onCloseDrawer?.();
            isOpenDrawer = false;
          }, 200);
          return;
        }
        if (drawer) {
          onCloseDrawer?.();
          isOpenDrawer = false;
          return;
        }
      }
    };

    isOpenDrawer;
  });

  // onDestroy(() => {
  //   if (!document) return;
  //   document.body.onmousedown = null;
  // });
</script>

{#if isOpenDrawer}
  <div
    class="drawer"
    bind:this={drawer}
    tabindex="0"
    role="menu"
    style={`
      ${style};
      ${anchor === "right" ? "right:0" : "left:0"};
      width:${width ? width : "50svw"};
      background-color:${backgroundColor};
      outline: ${outline};
      height: ${height ? height : "99svh"};  
      ${height ? "bottom: 0" : "top: 0"};
    `}
    transition:slide={animation ?? { duration: 500, axis: "x" }}
  >
    <div class="drawer-header">
      {@render header?.()}
      {#if closeButton}
        <CloseButton onclick={() => (isOpenDrawer = false)} />
      {/if}
    </div>
    <div class="drawer-content">
      {@render children?.()}
    </div>
  </div>
{/if}

<style>
  .drawer {
    position: fixed;
    height: 100%;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: width 2s;
    background-color: var(--color1);
    opacity: 0.95;
    padding-inline: 1rem;
    margin: 0.2rem;
    height: 99svh;
    border-radius: 1rem;
    border: 2px solid var(--primary-color);
  }

  .drawer-content {
    width: 100%;
    height: 100%;
    padding: 1rem;
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 1rem;
    flex-wrap: wrap-reverse;
    gap: 1rem;
    border-bottom: 2px solid var(--primary-color);
  }

  @media (max-width: 500px) {
    .drawer {
      width: 80%;
    }
  }

  :global([data-theme="dark"]) {
    .drawer {
      background-color: var(--dark-theme-background);
      color: var(--dark-theme-text);
    }
  }
  :global([data-theme="light"]) {
    .drawer {
      background-color: var(--light-theme-secondary);
      color: var(--light-theme-text);
    }
  }
</style>
