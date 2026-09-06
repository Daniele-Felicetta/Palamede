<script lang="ts">
const { children } = $props();
</script>

<div class="absolute-center">
  {@render children()}
</div>

<style>
  .absolute-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
</style>