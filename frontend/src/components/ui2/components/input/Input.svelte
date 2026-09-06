<script lang="ts">
  import { sxToString } from "../../utils/sxToString";
  
  type InputProps = {
    readonly type:
      | "button"
      | "color"
      | "date"
      | "datetime-local"
      | "email"
      | "file"
      | "hidden"
      | "image"
      | "month"
      | "number"
      | "password"
      | "radio"
      | "range"
      | "reset"
      | "search"
      | "submit"
      | "tel"
      | "text"
      | "time"
      | "url"
      | "week";
    readonly sx?: object;
    readonly name: string;
    readonly placeholder: string;
    readonly required?: boolean;
    readonly value?: string;
    readonly onChange?: (event: Event) => void;
    readonly onkeydown?: (event: KeyboardEvent) => void;
  };

  let {
    type = "text",
    name,
    placeholder,
    sx,
    required,
    value = $bindable(),
    onkeydown
  }: InputProps = $props();
</script>

<input
  bind:value
  {type}
  {name}
  {placeholder}
  {required}
  style={sxToString(sx)}
  {onkeydown}
/>

<style>
  input {
    border-radius: 4px;
    border: 1px solid #cfd5e2;
    padding-block: 0.7rem;
    padding-inline: 0.7rem;
    font-size: 1rem;
  }
  input:focus,
  input:focus-visible {
    outline-color: var(--primary-color) !important;
    background-color: antiquewhite;
  }

  :global([data-theme="dark"]) {
    input {
      background-color: var(--dark-theme-secondary);
      color: var(--dark-theme-text);
    }
  }
  :global([data-theme="light"]) {
    input {
      background-color: var(--light-theme-secondary);
      color: var(--light-theme-text);
    }
  }
</style>
