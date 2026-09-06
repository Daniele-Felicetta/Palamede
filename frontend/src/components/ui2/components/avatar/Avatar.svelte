<script lang="ts">
  import personIcon from "../../../../assets/person_icon.svg?url";

  type Props = {
    readonly src?: string;
  };
  let { src }: Props = $props();
</script>

<div class="avatar">
  <img src={src ?? personIcon} alt="avatar" />
</div>

<style>
  .avatar {
    outline: 1.5px var(--color_light);
    background-color: rgba(118, 118, 118, 0.495);
    width: 1rem;
    height: 1rem;
    text-align: center;
    padding: 0.05rem;
    border-radius: 1rem;
    display: flex;
    justify-content: center;
    overflow: hidden;
  }
</style>
