<script lang="ts">
  import { type Snippet } from "svelte";


  type DrawerProps = {
    readonly anchor?: "left" | "right";
    readonly header?: Snippet;
    readonly children?: Snippet;
    readonly backgroundColor?: String;
    readonly outline?: String;
    readonly isOpen: boolean;
  };

  let {
    anchor = "left",
    children,
    header,
    backgroundColor,
    outline,
    isOpen
  }: DrawerProps = $props();
</script>

<div
  class="drawer"
  tabindex="0"
  role="menu"
  style={`
    ${anchor === "right" ? "left:99999999px" : "left:0"};
     width:${isOpen ? "10.5rem" : "0"};
      background-color:${backgroundColor};
      outline: ${outline};
      `}
>
  <div class="drawer-header">
    {@render header?.()}
  </div>
  <div class="drawer-content">
    {@render children?.()}
  </div>
</div>

<style>
  .drawer-content {
    width: 100%;
    display: flex;
    justify-content: center;
    padding-block: 0.25rem;
  }
  .drawer {
    overflow-x: hidden;
    position: sticky;
    top: 0;
    height: 100%;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    background-color: #5a5a7f;
    transition: width 0.5s ease-in-out;
    height: 100svh;
    border: 2px solid var(--primary-color);
    flex-shrink: 0;
  }

  .drawer::-webkit-scrollbar {
    width: 4px;
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
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
