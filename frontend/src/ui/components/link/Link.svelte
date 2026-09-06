<script lang="ts">
  import { sxToString } from "$lib/ui/utils/sxToString";
  import type { Snippet } from "svelte";

  type LinkProps = {
    readonly href: string;
    readonly children: Snippet;
    readonly sx?: object;
    readonly blank?: boolean;
  };

  const { href, children, sx, blank }: LinkProps = $props();
</script>

<a {href} style={sxToString(sx)} target={blank ? "_blank" : ""}
  >{@render children()}</a
>

<style>
  a {
    color: var(--primary-color-text);
  }
</style>
