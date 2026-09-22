<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { HistoryEntry } from "../api";
  import {
    generateImage,
    getHistory,
    saveHistory,
    clearHistory,
    deleteHistory,
    historyImgUrl,
  } from "../api";
  import {
    refreshModels,
    switchModel,
    getCurrent,
    store,
  } from "../store.svelte";
  import { IMAGE_MODELS } from "../data/wiki";
  import { Images } from "../lib/images";
  import Shot from "../components/Shot.svelte";
  import WikiEntry from "../components/WikiEntry.svelte";
  import {
    Button,
    Dropzone,
    EmptyState,
    Field,
    Hintline,
    HistHead,
    Lightbox,
    ModelPlate,
    Panel,
    PromptBox,
    SectionHead,
  } from "../components/ui";
  import { notify } from "../desktop";

  // `localStorage` può lanciare (privacy mode / iframe sandbox): leggere la
  // preferenza in try/catch, non con un `typeof` che non basta a proteggere.
  const readPreviewPref = (): boolean => {
    try {
      return localStorage.getItem("palamede:preview") === "1";
    } catch {
      return false;
    }
  };

  // Stato unico della pagina (standard Svelte 5): un solo oggetto $state.
  // `current` è l'unica eccezione: è derivato dallo store, resta un $derived.
  let ui = $state({
    model: "bonsai" as Images.ModelId,
    prompt:
      "An icy bonsai tree in a rainy forest with a snowy mountain in the background, photo realistic",
    size: "512x512",
    steps: 4,
    seed: -1,
    count: 1,
    busy: false,
    hint: "",
    error: false,
    initImg: null as string | null, // img2img
    strength: 0.6,
    history: [] as HistoryEntry[],
    clearing: false,
    deleting: null as string | null,
    viewer: null as string | null, // id dell'immagine nel lightbox a schermo pieno
    preview: readPreviewPref(),
    previewUrl: null as string | null, // object URL del frame di preview in streaming
  });
  let current = $derived(getCurrent());

  // Preview in streaming: durante la generazione polla /api/preview (~2/s) e
  // mostra il denoise che si forma. Il toggle è persistito in localStorage.
  let previewTimer: number | null = null;
  const stopPreview = () => {
    if (previewTimer !== null) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
  };
  const startPreview = () => {
    stopPreview();
    if (!ui.preview) return;
    previewTimer = window.setInterval(async () => {
      try {
        const r = await fetch("/api/preview", { cache: "no-store" });
        if (r.status === 204) return;
        const blob = await r.blob();
        if (blob.size === 0) return;
        const url = URL.createObjectURL(blob);
        if (ui.previewUrl) URL.revokeObjectURL(ui.previewUrl);
        ui.previewUrl = url;
      } catch {
        /* la preview non blocca mai la generazione */
      }
    }, 500);
  };
  const togglePreview = (on: boolean) => {
    ui.preview = on;
    try {
      localStorage.setItem("palamede:preview", on ? "1" : "0");
    } catch {
      /* storage non disponibile */
    }
  };

  // Uscendo dalla pagina durante una generazione l'interval resterebbe vivo
  // (e la previewUrl non verrebbe revocata): fermalo allo smontaggio.
  onDestroy(() => {
    stopPreview();
    if (ui.previewUrl) {
      URL.revokeObjectURL(ui.previewUrl);
      ui.previewUrl = null;
    }
  });

  // Lightbox a schermo pieno: in Tauri il target=_blank non funziona, quindi
  // l'immagine si apre in un overlay che copre tutta la finestra.
  const fullIdx = $derived(ui.history.findIndex((s) => s.id === ui.viewer));
  const viewerEntry = $derived(fullIdx >= 0 ? ui.history[fullIdx] : null);
  const prevEntry = $derived(fullIdx > 0 ? ui.history[fullIdx - 1] : null);
  const nextEntry = $derived(
    fullIdx >= 0 && fullIdx < ui.history.length - 1
      ? ui.history[fullIdx + 1]
      : null,
  );
  const viewerPrev = () => {
    if (prevEntry) ui.viewer = prevEntry.id;
  };
  const viewerNext = () => {
    if (nextEntry) ui.viewer = nextEntry.id;
  };


  // cronologia persistente su disco (outputs/history) tramite hub
  onMount(() => {
    getHistory()
      .then((h) => (ui.history = h))
      .catch(() => (ui.history = []));
  });

  const reload = async () => {
    try {
      ui.history = await getHistory();
      ui.error = false;
    } catch {
      /* il prossimo giro */
    }
  };

  const pickModel = async (m: Images.ModelId) => {
    if (store.selecting) return;
    ui.model = m;
    ui.steps = Images.DEFAULT_STEPS[m];
    if (current === m) return;
    ui.hint = `caricamento ${Images.modelName(m)} sulla GPU…`;
    try {
      await switchModel(m);
      ui.hint = "";
    } catch (err) {
      ui.hint = String(err instanceof Error ? err.message : err);
      ui.error = true;
    }
  };

  const loadFile = async (f: File) => {
    try {
      ui.initImg = await Images.readImageAsDataURL(f);
      ui.error = false;
      ui.hint = Images.supportsImg2img(ui.model)
        ? "immagine caricata — img2img pronto"
        : "Bonsai non fa img2img: scegli Z-Image o Klein";
    } catch (err) {
      ui.hint =
        err instanceof Error ? err.message : "lettura dell'immagine fallita";
      ui.error = true;
    }
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!ui.prompt.trim() || ui.busy || store.selecting) return;
    if (ui.initImg && !Images.supportsImg2img(ui.model)) {
      ui.hint = "Bonsai non supporta image-to-image: scegli Z-Image o Klein";
      ui.error = true;
      return;
    }
    ui.busy = true;
    ui.error = false;
    ui.hint = ui.initImg
      ? "in coda sulla GPU (img2img)…"
      : "in coda sulla GPU…";
    const [w, h] = Images.parseSize(ui.size);
    ui.previewUrl = null;
    startPreview();
    try {
      if (current !== ui.model) {
        ui.hint = `caricamento ${ui.model} sulla GPU…`;
        await switchModel(ui.model);
      }
      const t0 = performance.now();
      const imgs = await generateImage({
        model: ui.model,
        prompt: ui.prompt.trim(),
        steps: ui.steps,
        seed: ui.seed,
        width: w,
        height: h,
        count: ui.count,
        image: ui.initImg ?? undefined,
        strength: ui.strength,
        preview: ui.preview,
        preview_interval: 8,
        preview_mode: "vae",
      });
      // salva in cronologia (un file per immagine) e rilegge la lista
      for (const im of imgs) {
        try {
          await saveHistory({
            model: ui.model,
            prompt: ui.prompt.trim(),
            size: ui.size,
            seed: im.seed,
            steps: ui.steps,
            timeMs: im.timeMs,
            dataUrl: im.dataUrl,
          });
        } catch (e) {
          console.warn("history save fallito", e);
        }
      }
      await reload();
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      ui.hint = `fatto: ${imgs.length}×${ui.size} in ${secs} s (attesa coda inclusa)`;
      notify(
        "Immagini pronte",
        `${imgs.length}×${ui.size} · ${Images.modelName(ui.model)} · ${secs} s`,
      );
      refreshModels();
    } catch (err) {
      ui.hint = String(err instanceof Error ? err.message : err);
      ui.error = true;
    } finally {
      stopPreview();
      if (ui.previewUrl) {
        URL.revokeObjectURL(ui.previewUrl);
        ui.previewUrl = null;
      }
      ui.busy = false;
    }
  };

  const reuse = (s: HistoryEntry) => {
    ui.model = s.model as Images.ModelId;
    ui.steps = Images.DEFAULT_STEPS[s.model as Images.ModelId] || s.steps;
    if (Images.isSizePreset(s.size)) ui.size = s.size;
    ui.seed = s.seed;
    ui.prompt = s.prompt;
    // Un'immagine di partenza di un altro modello resterebbe incoerente
    // (es. bonsai non fa img2img): si riparte puliti.
    ui.initImg = null;
    ui.strength = 0.6;
    ui.error = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const copyPrompt = async (s: HistoryEntry) => {
    try {
      await navigator.clipboard.writeText(s.prompt);
      ui.hint = "prompt copiato";
    } catch {
      /* no clipboard */
    }
  };

  const wipe = async () => {
    ui.clearing = true;
    try {
      await clearHistory();
      ui.history = [];
      ui.hint = "cronologia svuotata";
    } catch (err) {
      ui.hint = String(err instanceof Error ? err.message : err);
      ui.error = true;
    } finally {
      ui.clearing = false;
    }
  };

  const removeShot = async (id: string) => {
    if (ui.deleting) return;
    ui.deleting = id;
    try {
      await deleteHistory(id);
      ui.history = ui.history.filter((h) => h.id !== id);
      ui.hint = "immagine eliminata";
    } catch (err) {
      ui.hint = String(err instanceof Error ? err.message : err);
      ui.error = true;
    } finally {
      ui.deleting = null;
    }
  };

  const plateState = (id: Images.ModelId) => {
    if (store.selecting === id) return "…carico";
    if (current === id) return "attivo";
    return "a riposo";
  };
</script>

<div class="gen-wrap">
  <Panel as="form" onsubmit={submit}>
    <div class="plates" role="radiogroup" aria-label="Modello">
      {#each IMAGE_MODELS as m (m.id)}
        <ModelPlate
          role="radio"
          aria-checked={ui.model === m.id}
          name={m.name}
          selected={ui.model === m.id}
          led={current === m.id ? 'on' : store.selecting === m.id ? 'busy' : 'off'}
          stamps={[
            { text: m.family },
            { text: Images.modelStamp(m.id as Images.ModelId), tone: 'hot' },
          ]}
          down={`${plateState(m.id as Images.ModelId)} · ${Images.modelTagline(m.id as Images.ModelId)}`}
          onclick={() => pickModel(m.id as Images.ModelId)}
        />
      {/each}
    </div>

    {#if ui.initImg}
      <div class="img2img-prep">
        <img src={ui.initImg} alt="immagine di partenza" />
        <div class="img2img-meta">
          <label for="strength">Forza del cambiamento</label>
          <div class="img2img-row">
            <input
              id="strength"
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              bind:value={ui.strength}
            />
            <span class="img2img-val">{ui.strength.toFixed(2)}</span>
          </div>
          <Button
            variant="side"
            onclick={() => {
              ui.initImg = null;
              ui.hint = "";
              ui.error = false;
            }}
          >
            rimuovi immagine
          </Button>
        </div>
      </div>
    {:else}
      <Dropzone onfile={loadFile}>
        <span
          >+ Trascina un'immagine qui per <em>image-to-image</em><br />o clicca
          per sceglierne una</span
        >
      </Dropzone>
    {/if}

    <PromptBox
      bind:value={ui.prompt}
      placeholder="Descrivi l'immagine…"
      ariaLabel="Prompt"
    />

    <div class="field-row">
      <Field label="Formato" for="size">
        <select id="size" bind:value={ui.size}
          >{#each Images.SIZES as [v, lab] (v)}<option value={v}
              >{v} · {lab}</option
            >{/each}</select
        >
      </Field>
      <Field label="Step" for="steps">
        <input
          id="steps"
          type="number"
          min={1}
          max={50}
          bind:value={ui.steps}
        />
      </Field>
      <Field label="Seed" for="seed">
        <input id="seed" type="number" min={-1} step={1} bind:value={ui.seed} />
      </Field>
      <Field label="Copie" for="count">
        <input
          id="count"
          type="number"
          min={1}
          max={4}
          bind:value={ui.count}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            ui.count = Number.isFinite(v) ? Math.min(4, Math.max(1, v)) : 1;
          }}
        />
      </Field>
    </div>

    <label class="preview-toggle">
      <input
        type="checkbox"
        checked={ui.preview}
        onchange={(e) => togglePreview(e.currentTarget.checked)}
      />
      preview in streaming (denoise in diretta · solo modelli sd)
    </label>

    {#if ui.previewUrl}
      <div class="preview-box">
        <img src={ui.previewUrl} alt="preview del denoise in corso" />
        <span>denoise in corso…</span>
      </div>
    {/if}

    <Button
      type="submit"
      disabled={ui.busy || !!store.selecting || !ui.prompt.trim()}
    >
      {store.selecting
        ? "caricamento…"
        : ui.busy
          ? "in lavorazione…"
          : "Genera"}
    </Button>
    <Hintline err={ui.error}>{ui.hint}</Hintline>
  </Panel>

  <section class="hist" aria-label="Cronologia">
    <HistHead eyebrow="Cronologia" title="Ultime generazioni">
      {#snippet actions()}
        {#if ui.history.length > 0}
          <Button variant="side" onclick={wipe} disabled={ui.clearing}>
            {ui.clearing ? "svuoto…" : `svuota (${ui.history.length})`}
          </Button>
        {/if}
      {/snippet}
    </HistHead>

    {#if ui.history.length === 0}
      <EmptyState>
        Nessuna generazione salvata.<br />Genera un'immagine: finisce qui,
        persistente tra una sessione e l'altra.
      </EmptyState>
    {:else}
      <div class="gallery">
        {#each ui.history as s (s.id)}
          <Shot
            src={historyImgUrl(s.id)}
            alt={s.prompt}
            title={s.prompt}
            model={Images.modelName(s.model)}
            size={s.size}
            timeMs={s.timeMs}
            seed={s.seed}
            steps={s.steps}
            deleting={ui.deleting === s.id}
            disabled={!!ui.deleting}
            onopen={() => (ui.viewer = s.id)}
            onreuse={() => reuse(s)}
            oncopy={() => copyPrompt(s)}
            onremove={() => removeShot(s.id)}
          />
        {/each}
      </div>
    {/if}
  </section>
</div>

<section class="wiki">
  <SectionHead
    title="Wiki · modelli immagini"
    sub="Come funzionano, quanto occupano, quanto tempo mettono (misurato su questa macchina) e cosa rendono. Esempi prodotti dai modelli stessi."
  />
  {#each IMAGE_MODELS as m (m.id)}<WikiEntry model={m} />{/each}
</section>

{#if ui.viewer}
  <Lightbox
    open={!!viewerEntry}
    src={viewerEntry ? historyImgUrl(viewerEntry.id) : ""}
    alt={viewerEntry?.prompt ?? ""}
    caption={viewerEntry
      ? `${Images.modelName(viewerEntry.model)} · ${viewerEntry.size} · ${(viewerEntry.timeMs / 1000).toFixed(1)} s · seed ${viewerEntry.seed}`
      : ""}
    index={fullIdx}
    total={ui.history.length}
    onclose={() => (ui.viewer = null)}
    onprev={prevEntry ? viewerPrev : undefined}
    onnext={nextEntry ? viewerNext : undefined}
  />
{/if}
