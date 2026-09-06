<script lang="ts">
  import { fade, scale } from "svelte/transition";
  import Button from "../button/Button.svelte";

  type Props = {
    readonly onFocus?: () => void;
    readonly onSelectItem: (item: any) => void;
    readonly placeholder?: string;
    readonly comboItems: { name: string; value: any }[];
    readonly disabled?: boolean;
    readonly onFocusOut?: () => void;
  };

  let { comboItems, onFocus, onSelectItem, placeholder, onFocusOut }: Props =
    $props();

  let inputHaveFocus = $state(false);
  let mouseOnDivInput = $state(false);
  let isOpen: boolean = $state(false);
  let disabled: boolean = $state(false);
  let comboResFiltered = $state<any>(null);

  let searchText = $state("");

  function filterRes() {
    if (!searchText) {
      comboResFiltered = comboItems;
    } else {
      comboResFiltered = comboItems.filter((item) =>
        item.name.toLowerCase().includes(searchText.toLowerCase()),
      );
    }
  }

  function selectItem(item: { name: string; value: any }) {
    onSelectItem(item);
    searchText = item.name;
    isOpen = false;
  }

  const onInputFocus = () => {
    onFocus?.();
    inputHaveFocus = true;
    isOpen = true;
  };

  const onInputFocusOut = () => {
    if (inputHaveFocus && !mouseOnDivInput) {
      onFocusOut?.();
      inputHaveFocus = false;
      isOpen = false;
    }
  };

  $effect(() => {
    if (comboItems && comboItems.length >= 2) {
      disabled = false;
      filterRes();
    } else if (comboItems.length === 1) {
      filterRes();
      searchText = comboItems[0].name;
      disabled = true;
    }
  });
</script>

<div
  class="search-select"
  role="application"
  onmouseleave={() => (mouseOnDivInput = false)}
  onmouseenter={() => (mouseOnDivInput = true)}
>
  <input
    type="text"
    bind:value={searchText}
    id="combo-box-input"
    onfocus={onInputFocus}
    onfocusout={onInputFocusOut}
    onclick={() => (isOpen = true)}
    {placeholder}
    {disabled}
    autocomplete="off"
  />
  {#if isOpen}
    <ul class="dropdown" transition:scale={{ duration: 150 }}>
      {#each comboResFiltered as item}
        <li>
          <Button
            sx={{ width: "100%" }}
            onclick={() => {
              console.log(item);
              selectItem(item);
              isOpen = false;
            }}
          >
            <p>{item.name}</p>
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  p {
    margin: 0;
    padding: 0;
  }
  .search-select {
    position: relative;

    margin-right: 1.6rem;
  }

  .search-select input {
    width: 100%;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
  }
  .search-select input:focus-visible {
    border: 1 px solid transparent;
  }

  .dropdown {
    position: absolute;
    width: 100%;
    top: 100%;
    background: var(--color1-light);
    border-top: none;
    max-height: 200px;
    overflow-y: auto;
    z-index: 10;
    list-style: none;
    margin: 0;
    padding: 0.75rem;
    border-radius: 0.25rem;
  }

  .dropdown li {
    cursor: pointer;
    width: 100%;
    margin: 0.5rem 0;
  }

  .dropdown li:hover {
    background-color: #f0f0f0;
  }
</style>
