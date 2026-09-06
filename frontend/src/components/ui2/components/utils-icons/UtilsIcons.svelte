<script lang="ts">
    import IconButton from "../icon-button/IconButton.svelte";
  import DeleteIcon from "./assets/delete_icon.svg?url";
  import InfoIcon from "./assets/info_icon.svg?url";
  let {onDelete, onInfo} = $props()
</script>

<div class="icons">
  <IconButton
    src={DeleteIcon}
    title="Delete"
    size="small"
    sx={{ padding: 0 }}
    onclick={onDelete}
  />
  <IconButton
    src={InfoIcon}
    title="Info"
    size="small"
    sx={{ padding: 0 }}
    onclick={onInfo}
  />
</div>
<style>
  .icons {
    display: flex;
    gap: 0.4rem;
    margin-left: 0.6rem;
    margin-right: 0.4rem;
  }
</style>