<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    label?: String;
    deletable?: boolean;
    onDelete?: () => void;
    children?: Snippet;
  };

  let { label, deletable, onDelete, children }: Props = $props();
</script>

<div class="chip">
  {@render children?.()}
  <span>{label}</span>
  {#if deletable}
    <button class="delete-btn" on:click|stopPropagation={onDelete}>✕</button>
  {/if}
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.15rem;
    border-radius: 16px;
    background-color: var(--primary-color);
    font-size: 0.7rem;
    cursor: default;
    height: 1rem;
    transition: background-color 0.2s ease;
  }

  .chip:hover {
    background-color: var(--primary-color-hover);
  }

  .chip:active {
    background-color: var(--secondary-color);
  }

  /* .chip.clickable {
    cursor: pointer;
  } */

  .delete-btn {
    background: none;
    border: none;
    margin-left: 0.5rem;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .delete-btn:hover {
    color: red;
  }
</style>
