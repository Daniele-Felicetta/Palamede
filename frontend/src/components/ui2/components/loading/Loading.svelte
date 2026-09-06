<script lang="ts">
    import { sxToString, type SxType } from "../../utils/sxToString";
import Image from "../image/Image.svelte";
import "./scale.css";
import "./spin.css";

export type LoadingProps = {
  readonly sx?: SxType
	readonly variant?: "scale" | "spin";
	readonly color?: string;
	readonly center?: boolean;
	readonly src?: string;
	readonly defaultSrc?: string;
	readonly scaleSize?: number;
};

const {
  sx,
	variant = "spin",
	src,
	color,
	center,
	scaleSize,
}: LoadingProps = $props();
</script>


<div
  class={`${variant} ${center && "center"}`}
  style={`
    --color: ${src ? "transparent" : color};
    --velocity: ${src ? "2s" : "1s"};
    ${sxToString(sx)};
  `}
>
  {#if src}
    <Image {src} loading alt="" {scaleSize} />
  {/if}
</div>

<style>
  .center {
    margin: 0 auto;
  }
</style>
