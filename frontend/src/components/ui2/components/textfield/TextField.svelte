<script lang="ts">
  import type { Snippet } from "svelte";
  import sendIcon from "../../../../assets/send_icon.svg?url";

  type Props = {
    readonly onSubmit: () => void;
    readonly isLoading: boolean;
    readonly disabled: boolean;
    readonly children?: Snippet;
    readonly value: String;
  };
  let {
    onSubmit,
    isLoading,
    children,
    disabled,
    value = $bindable(),
  }: Props = $props();
</script>

<div class="container">
  {@render children?.()}

  <div class="input_wrapper">
    <input
      id="text_input"
      type="text"
      bind:value
      onkeydown={(e) => e.key === "Enter" && onSubmit()}
    />
    <button onclick={() => onSubmit()} disabled={isLoading || disabled}>
      <img src={sendIcon} alt="send message" width="20" height="20" />
    </button>
  </div>
</div>

<style>
  .info {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
  }
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    bottom: 1rem;
    width: 100%;
  }
  p {
    padding: 0;
    margin: 0;
    color: azure;
  }
  img {
    margin-top: 2px;
  }
  button:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }
  button {
    border-radius: 20px;
    border: 0;
    background-color: transparent;
    transition: all 0.5s ease-out;
    perspective: 1000px;
  }
  button:hover {
    transform: rotateZ(-0.1turn);
    transition: all 0.3s ease-in-out;
  }
  button:active {
    transform: rotateZ(-0.25turn);
    transition: all 0.1s;
    box-shadow: 20px 100px 200px rgba(104, 1, 104, 0.379);
  }
  input {
    width: 100%;
    height: 1.2rem;
    border-radius: 50px;
    border: 0px solid rgba(219, 1, 253, 0.119);
    background-color: #fff;
    padding: 2px 0px 2px 10px;
  }
  input:focus-visible {
    outline: 0;
  }
  .input_wrapper {
    width: 100%;
    height: 1.2rem;
    border-radius: 50px;
    border: 1px solid rgba(219, 1, 253, 0.119);
    padding: 4px 4px 4px 0;
    background-color: #fff;
    display: flex;
    align-items: center;
  }
  .input_wrapper:focus-within {
    outline: 1px;
    box-shadow: 0 0 15px rgba(104, 1, 104, 0.379);
    border-radius: 50px;
  }
</style>
