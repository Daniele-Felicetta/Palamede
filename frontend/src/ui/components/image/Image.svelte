<script lang="ts">
  type ImageProps = {
    readonly width?: string;
    readonly height?: string;
    readonly src?: string;
    readonly alt?: string;
    readonly squarize?: boolean;
    readonly loading?: boolean;
    readonly scaleSize?: number;
    readonly borderRadius?: string;
  };
  const {
    width,
    height,
    src,
    alt = "Snoopy Image",
    loading,
    squarize,
    scaleSize,
    borderRadius
  }: ImageProps = $props();
</script>

<div class="image-external-wrapper">
  <div class={squarize || loading ? "squarize" : ""}>
    <img
      style={`
        transform:scale(${scaleSize ?? 1.5});
        width:${width}
        height: ${height};
        border-radius: ${borderRadius};
      `}
    class={loading ? "loading" : ""}
    {src}
    {alt}
    />
  </div>
</div>

<style>
  .image-external-wrapper {
    display: flex;
    justify-content: center;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover; /* Adatta l'immagine senza deformarla */
  }
  .squarize {
    width: 200px;
    height: 200px;
    padding-top: 100%; /* Mantiene un rapporto 1:1 per la quadratura */
    overflow: hidden;
    border-radius: 10000px;
  }

  .loading {
    position: absolute;
    border-radius: 10000px;
    top: 0;
    left: 0;
    scale: var(--scale-size);
    width: 100%;
    height: 100%;
    object-fit: cover; /* Adatta l'immagine senza deformarla */
  }
</style>
