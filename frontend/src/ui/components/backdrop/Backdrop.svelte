<script lang="ts">
    import type { Snippet } from "svelte";
import AbsoluteCenter from "../absolute-center/AbsoluteCenter.svelte";
    import { fade } from "svelte/transition";

type BackdropProps ={
  children: Snippet;
  onClick?: () => void;
}
const { children, onClick }: BackdropProps  = $props();

</script>

<div class="backdrop" transition:fade={{duration:300}} onclick={onClick} role="none">
  <AbsoluteCenter>
    {@render children()}
  </AbsoluteCenter>
</div>

<style>
  .backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
</style>
