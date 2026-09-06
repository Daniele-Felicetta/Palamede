<script lang="ts">
  import type { Snippet } from "svelte";
    import ButtonBase from "../button-base/ButtonBase.svelte";

  type ButtonProps = {
    readonly isActive?: boolean;
    readonly children: Snippet;
    readonly onclick?: () => void;
    readonly type?: "button" | "submit" | "reset" | null | undefined;
    readonly isHover?: boolean;
    readonly variant?: "outlined" | "contained" | "text";
    readonly sx?: object;
    readonly disabled?: boolean;
  };

  const {
    isActive,
    children,
    onclick,
    type = "button",
    sx,
    isHover,
    disabled,
    variant = "text",
  }: ButtonProps = $props();
</script>

<ButtonBase
  {sx}
  {isActive}
  {variant}
  {isHover}
  {type}
  {onclick}
  {disabled}
>
  {@render children()}
</ButtonBase>