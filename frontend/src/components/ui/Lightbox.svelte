<script lang="ts">
  let {
    open,
    src = '',
    alt = '',
    caption = '',
    index = 0,
    total = 0,
    onclose,
    onprev,
    onnext,
  }: {
    open: boolean
    src?: string
    alt?: string
    caption?: string
    index?: number
    total?: number
    onclose?: () => void
    onprev?: () => void
    onnext?: () => void
  } = $props()

  $effect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose?.()
      else if (e.key === 'ArrowLeft') onprev?.()
      else if (e.key === 'ArrowRight') onnext?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  })
</script>

{#if open}
  <div
    class="lightbox"
    role="dialog"
    aria-modal="true"
    aria-label="immagine a schermo pieno"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) onclose?.()
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onclose?.()
    }}
  >
    <div class="lb-bar">
      <span class="lb-count">{total > 0 ? `${index + 1} / ${total}` : ''}</span>
      <button type="button" class="lb-close" onclick={() => onclose?.()} aria-label="chiudi">×</button>
    </div>

    {#if onprev}
      <button type="button" class="lb-nav lb-prev" onclick={onprev} aria-label="precedente">‹</button>
    {/if}

    <figure class="lb-stage">
      {#if src}
        <img src={src} alt={alt} title={alt} />
      {/if}
      {#if caption}
        <figcaption class="lb-cap">{caption}</figcaption>
      {/if}
    </figure>

    {#if onnext}
      <button type="button" class="lb-nav lb-next" onclick={onnext} aria-label="successiva">›</button>
    {/if}
  </div>
{/if}
