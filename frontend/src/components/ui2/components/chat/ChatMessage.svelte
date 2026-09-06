<script lang="ts">
  import Avatar from "../avatar/Avatar.svelte";
  import { micromark } from "micromark";

  type Props = {
    text: string;
    avatar?: string;
    right?: boolean;
  };

  let { text, avatar, right }: Props = $props();
</script>

{#if right}
  <div class="text textRight">
    {@html micromark(text as any)}
    <Avatar src={avatar} />
  </div>
{:else}
  <div class="text textLeft">
    <Avatar src={avatar} />
    {@html micromark(text as any)}
  </div>
{/if}

<style>
  .text {
    background-color: bisque;
    border-radius: 0.5rem;
    padding: 0.5rem;
    gap: 0.5rem;
  }

  .textRight {
    text-align: right;
    align-self: flex-end;
    flex-direction: row;
    margin-left: 1rem;
  }
  .textRight {
    margin-right: 1rem;
  }
</style>
