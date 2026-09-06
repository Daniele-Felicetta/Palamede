<script lang="ts">
  import Drawer from "../drawer/Drawer.svelte";
  import ComboBox from "../combo-box/ComboBox.svelte";
  import TextField from "../textfield/TextField.svelte";
  import ChatMessages from "../chat/ChatMessages.svelte";

  let isOpenDrawer = $state(false);
  let textFieldValue = $state("");

  type Props = {
    readonly chatbotImage: string;
    readonly avatarLeft?: string;
    readonly avatarRight?: string;
    readonly onSubmit: (value: string) => void;
    readonly texts: {
      readonly text: string;
      readonly position?: "left" | "right";
    }[];
    readonly comboItems?: { name: string; value: any }[];
    readonly anchor?:
      | "top-right"
      | "top-left"
      | "bottom-right"
      | "bottom-left"
      | string;
    readonly anchorChat?:
      | "top-right"
      | "top-left"
      | "bottom-right"
      | "bottom-left"
      | string;
  };

  let {
    chatbotImage,
    anchor = "bottom-right",
    anchorChat = "bottom-right",
    avatarLeft,
    avatarRight,
    texts,
    comboItems,
    onSubmit,
  }: Props = $props();

  let anchorStyles = {
    "top-right": "top: 1rem; right: 1rem;",
    "top-left": "top: 1rem; left: 1rem;",
    "bottom-right": "bottom: 1rem; right: 1rem;",
    "bottom-left": "bottom: 1rem; left: 1rem;",
  };
  const getAnchorStyle = (value: string) => {
    if (
      value !== "top-right" &&
      value !== "top-left" &&
      value !== "bottom-right" &&
      value !== "bottom-left"
    ) {
      return value;
    }
    return anchorStyles[value];
  };
</script>

<div class="chatbot-wrapper" style={`${getAnchorStyle(anchor)}`}>
  <img
    src={chatbotImage}
    title={"Open Chatbot"}
    onclick={() => (isOpenDrawer = !isOpenDrawer)}
    style="width: 200px; cursor: pointer;"
  />
  <Drawer
    bind:isOpenDrawer
    height="35rem"
    animation={{ duration: 300, axis: "y" }}
    style={`${getAnchorStyle(anchorChat)}`}
    closeButton
  >
    {#snippet header()}
      <div
        class="chatbot-header"
        style="display: flex; align-items: center; gap: 1rem;"
      >
        <img src={avatarLeft} alt="Chat Icon" style="width: 50px;" />
        {#if comboItems}
          <ComboBox
            onSelectItem={(item: any) => {
              console.log("Selected item:", item);
            }}
            {comboItems}
          />
        {/if}
      </div>
    {/snippet}
    <div class="chatbot">
      <ChatMessages {texts} {avatarRight} {avatarLeft}>
        <TextField
          onSubmit={() => onSubmit(textFieldValue)}
          bind:value={textFieldValue}
          isLoading={false}
          disabled={false}
        />
      </ChatMessages>
      <div class="textfield"></div>
    </div>
  </Drawer>
</div>

<style>
  .chatbot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    height: 100%;
  }

  .chatbot-header {
  }
  .chatbot-wrapper {
    position: fixed;
    z-index: 10001;
  }
  .chatbot-wrapper > img:hover {
    transform: scale(1.05);
    transform: translateY(-2px);
    transform: rotate(-5deg);
    transition: transform 0.2s;
  }
</style>
