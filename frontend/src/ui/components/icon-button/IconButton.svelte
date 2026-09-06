<script lang="ts">
  import ButtonBase from "../button-base/ButtonBase.svelte";
  import { sxToString } from "../../utils/sxToString";
  import Tooltip from "../tooltip/Tooltip.svelte";

  type IconButtonProps = {
    readonly src: string;
    readonly href?: string;
    readonly isActiveFromPath?: boolean;
    readonly isActive?: boolean;
    readonly isHover?: boolean;
    readonly onclick?: () => void;
    readonly onmouseenter?: () => void;
    readonly type?: "button" | "submit" | "reset" | null | undefined;
    readonly sx?: object;
    readonly imageSx?: object;
    readonly title: string;
    readonly size?: "micro"| "small" | "medium" | "large" | number;
    readonly hideTooltip?: boolean;
    readonly tooltipSx?: object;
    readonly disabled?: boolean;
  };

  let {
    src,
    href,
    onclick,
    onmouseenter,
    isActiveFromPath,
    isHover = true,
    type = "button",
    sx,
    isActive = $bindable(),
    imageSx,
    title,
    size,
    hideTooltip,
    tooltipSx,
    disabled,
  }: IconButtonProps = $props();

  const sizeDictionary = {
    micro: 0.75,
    small: 1,
    medium: 1.5,
    large: 2,
  };

  const imageInStyle = () => {
    let sizeStyle = "";
    if (typeof size === "number") {
      sizeStyle = `width: ${size}rem; height: ${size}rem`;
    } else if (size) {
      sizeStyle = `width: ${sizeDictionary[size]}rem; height: ${sizeDictionary[size]}rem`;
    }
    const finalStyle = `${sxToString(imageSx)}; ${sizeStyle};`;
    return finalStyle;
  };

  // if (isActiveFromPath && href) {
  //   $effect(() => {
  //     isActive = $page.url.pathname === href;
  //   });
  // }

  const onClickButton = () => {
    if (href) {
      window.location.href = href
    }
    if (onclick) {
      onclick();
    }
  };
</script>

<Tooltip {title} hide={hideTooltip} sx={tooltipSx}>
  <ButtonBase
    {isHover}
    {type}
    {sx}
    {onmouseenter}
    {isActive}
    variant="icon"
    onclick={onClickButton}
    {disabled}
  >
    <img
      id="notToDragImg"
      draggable="false"
      {src}
      alt={title}
      style={imageInStyle()}
    />
  </ButtonBase>
</Tooltip>

<style>
  img {
    user-select: none !important;
    -webkit-user-drag: none;
  }
</style>
