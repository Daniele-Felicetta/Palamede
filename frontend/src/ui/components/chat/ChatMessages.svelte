<script lang="ts">
  import type { Snippet } from "svelte";
  import ChatMessage from "./ChatMessage.svelte";

  type Props = {
    readonly texts: {
      readonly text: string;
      readonly position?: "left" | "right";
    }[];
    readonly avatarRight?: string;
    readonly avatarLeft?: string;
    readonly children?: Snippet;
  };

  let { texts, avatarLeft, avatarRight, children }: Props = $props();
</script>

<div class="chat">
  <div>
    {#each texts as { text, position }, i}
      {@const pair = i % 2 === 0}

      <ChatMessage
        {text}
        right={position === "right" || !pair ? true : false}
        avatar={position === "right" || !pair ? avatarRight : avatarLeft}
      />
    {/each}
  </div>
  {@render children?.()}
</div>

<style>
  .chat {
    background-color: var(--color1-light);
    width: 100%;
    min-height: 100px;
    height: 100%;
    border-radius: 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.5rem;
    overflow: auto;
  }
</style>
