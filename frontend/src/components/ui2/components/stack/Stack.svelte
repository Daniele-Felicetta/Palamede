<script lang="ts">
  import { sxToString, type SxType } from "../../utils/sxToString";
  import type { Snippet } from "svelte";

  type StackProps = {
    readonly sx?: SxType;
    readonly children: Snippet;
    readonly gap?: number;
    readonly height?: string;
    readonly row?: boolean;
    readonly align?: boolean;
    readonly onMouseDown?: (event: MouseEvent) => void;
    readonly center?: boolean;
  };
  const {
    sx,
    children,
    gap,
    height,
    row,
    onMouseDown,
    align,
    center,
  }: StackProps = $props();

  const customStyle = $derived.by(() => {
    if (!(sx || gap || height || row || center || align)) return undefined;

    const styles = [
      sxToString(sx),
      gap ? `gap: ${gap}rem` : "",
      height ? `height: ${height}` : "",
      center ? "justify-content: center" : "",
      row ? "flex-direction: row" : "",
      align ? "align-items: center" : "",
    ];

    return styles.filter(Boolean).join("; ") || undefined;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="stack scrollbar" style={customStyle} onmousedown={onMouseDown}>
  {@render children()}
</div>

<style>
  .stack {
    display: flex;
    flex-wrap: wrap;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
