<script lang="ts">
import type { Snippet } from "svelte";
import AbsoluteCenter from "../absolute-center/AbsoluteCenter.svelte";
import Backdrop from "../backdrop/Backdrop.svelte";

type FullScreenWrapper = {
	readonly backdrop?: boolean;
	readonly children: Snippet;
};

const { backdrop, children }: FullScreenWrapper = $props();
</script>

{#if backdrop}
  <Backdrop>
    {@render children()}
  </Backdrop>
{:else}
  <AbsoluteCenter>
    {@render children()}
  </AbsoluteCenter>
{/if}
