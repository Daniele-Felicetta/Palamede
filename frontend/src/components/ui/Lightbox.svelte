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

  let box: HTMLDivElement | undefined = $state()

  // Apertura: blocca lo scroll, sposta il focus dentro il dialogo, gestisci i
  // tasti (Esc/frecce) e intrappola Tab; alla chiusura ripristina il focus su
  // chi l'aveva prima (niente focus perso nel vuoto).
  $effect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    box?.focus()
    const focusables = () =>
      Array.from(
        box?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose?.()
      else if (e.key === 'ArrowLeft') onprev?.()
      else if (e.key === 'ArrowRight') onnext?.()
      else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      prevFocus?.focus?.()
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
    bind:this={box}
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
