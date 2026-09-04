<script lang="ts">
  let {
    src,
    alt = "",
    title = "",
    model = "",
    size = "",
    timeMs,
    seed,
    steps,
    deleting = false,
    disabled = false,
    onopen,
    onreuse,
    oncopy,
    onremove,
  }: {
    src: string;
    alt?: string;
    title?: string;
    model?: string;
    size?: string;
    timeMs?: number;
    seed?: number;
    steps?: number;
    deleting?: boolean;
    disabled?: boolean;
    onopen?: () => void;
    onreuse?: () => void;
    oncopy?: () => void;
    onremove?: () => void;
  } = $props();

  const whoLine = $derived(
    model && size ? `${model} · ${size}` : model || size || "",
  );
  const numsLine = $derived(
    [
      timeMs != null ? `${(timeMs / 1000).toFixed(1)} s` : "",
      seed != null ? `seed ${seed}` : "",
      steps != null ? `${steps} step` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<figure class="shot">
  <div class="shot-thumb">
    {#if onopen}
      <button
        type="button"
        class="shot-open"
        onclick={onopen}
        title="apri a schermo pieno"
        aria-label="apri a schermo pieno"
      >
        <img src={src} alt={alt} loading="lazy" />
      </button>
    {:else}
      <img src={src} alt={alt} loading="lazy" />
    {/if}

    {#if onremove}
      <button
        type="button"
        class="shot-del {deleting ? 'busy' : ''}"
        onclick={onremove}
        title="Elimina immagine"
        aria-label="Elimina immagine"
        disabled={disabled || deleting}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14h10l1-14" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    {/if}
  </div>

  {#if title || whoLine || numsLine}
    <figcaption class="meta">
      {#if whoLine}
        <div class="who">{whoLine}</div>
      {/if}
      {#if title}
        <p title={title}>“{title}”</p>
      {/if}
      {#if numsLine}
        <div class="nums">{numsLine}</div>
      {/if}
      {#if onreuse || oncopy}
        <div class="shot-actions">
          {#if onreuse}
            <button
              type="button"
              onclick={onreuse}
              title="Riporta modello, prompt e parametri nel pannello"
              disabled={disabled}
              >riusa</button
            >
          {/if}
          {#if oncopy}
            <button
              type="button"
              onclick={oncopy}
              title="Copia il prompt negli appunti"
              disabled={disabled}
              >copia</button
            >
          {/if}
        </div>
      {/if}
    </figcaption>
  {/if}
</figure>
