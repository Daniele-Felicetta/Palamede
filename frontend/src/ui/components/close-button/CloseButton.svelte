<script lang="ts">
  import closeIcon from "../../../../assets/close_icon.svg?url";
  import IconButton from "../icon-button/IconButton.svelte";

  let { onclick } = $props();
</script>

<IconButton title="Close" src={closeIcon} {onclick} />
