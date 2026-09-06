<script lang="ts">
  import { sxToString } from "../../utils/sxToString";
  import type { Snippet } from "svelte";
  import { scale, slide } from "svelte/transition";

  type ButtonBaseProps = {
    readonly isActive?: boolean;
    readonly children: Snippet;
    readonly onclick?: () => void;
    readonly onmouseenter?: () => void;
    readonly onmouseover?: () => void;
    readonly type: "button" | "submit" | "reset" | null | undefined;
    readonly isHover?: boolean;
    readonly variant?: "text" | "outlined" | "contained" | "icon";
    readonly sx?: object;
    readonly disabled?: boolean;
  };

  let {
    isActive,
    children,
    onclick,
    type,
    sx,
    onmouseover,
    onmouseenter,
    isHover,
    variant = "text",
    disabled,
  }: ButtonBaseProps = $props();

  const styleSx = sxToString(sx);
  const style = styleSx ? `${styleSx}` : "";
</script>

<button
  transition:scale={{ duration: 150 }}
  aria-label="button"
  {type}
  {onclick}
  {style}
  {onmouseenter}
  class:hover={isHover}
  class:active={isActive}
  class={`${variant} ${disabled ? "disabled" : ""}`}
  {disabled}
>
  {@render children()}
</button>

<style>
  button {
    border-radius: 4px;
    background-color: var(--color1);
    cursor: pointer;
    border: none;
    padding: 10px;
    box-shadow:
      1.1px 1.1px 0px 1px var(--color1),
      2px 2px 1.75px 1px rgba(0, 0, 0, 0.906),
      0px 0px 1px 1px var(--color2);
  }

  button:hover {
    outline: 2px groove var(--color1-hover);
    box-shadow: 2px 2px 2px var(--color1-hover);
  }

  .icon {
    padding: 8px;
    padding-top: 9px;
    padding-bottom: 5px;
    padding-left: 9px;
  }

  .contained {
    background-color: var(--primary-color);
    color: white;
  }

  .outlined {
    outline: 2px solid var(--primary-color);
    color: black;
  }

  .active {
    outline: 3px groove var(--primary-color);
    background-color: var(--primary-color);
  }

  .disabled {
    color: whitesmoke;
    cursor: not-allowed;
    opacity: 0.4;
  }

  .disabled:hover {
    outline: none;
  }

  :global([data-theme="dark"]) {
    button {
      background-color: var(--primary-color);
      color: var(--dark-theme-text);
    }
  }
  :global([data-theme="light"]) {
    button {
      background-color: var(--primary-color);
      color: var(--light-theme-text);
    }
  }
</style>
