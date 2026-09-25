<script lang="ts">
  import { navigate } from "../../../router.svelte";
  import { onMount } from "svelte";
  import "./game.css";
  import {
    Button,
    Eyebrow,
    Field,
    Panel,
    SectionHead,
  } from "../../../components/ui";
  import { GENRES, STYLES, IMAGE_MODELS, DEFAULT_IMAGE_MODEL, IMAGE_SIZES, DEFAULT_IMAGE_SIZE, NARRATOR_MODELS, DEFAULT_NARRATOR } from "./data";
  import { gameSession, saveSession } from "./session.svelte";
  import { listStories, getStory, deleteStory, storyImage, narratorsStatus, type StorySummary, type StoryDetail } from "../../../api";

  // La sessione sopravvive in sessionStorage: se torni al setup a metà
  // partita ritrovi le tue scelte invece dei default; "esci" riparte da zero.
  let genre = $state(gameSession.genre);
  let styleId = $state(gameSession.style);
  let name = $state(gameSession.name);
  let modelId = $state(gameSession.model || DEFAULT_IMAGE_MODEL);
  let sizeId = $state(gameSession.size || DEFAULT_IMAGE_SIZE);
  let narratorId = $state(gameSession.narrator || DEFAULT_NARRATOR);
  let hint = $state("");
  // Voci cloud (Gemini): visibili solo se l'hub ha la chiave. Lista ufficiale
  // dal server, fallback a quella locale se l'hub non risponde.
  let cloudNarrators = $state<{ id: string; label: string; hint: string }[]>([]);
  let cloudConfigured = $state(false);
  const narratorOptions = $derived([...NARRATOR_MODELS, ...cloudNarrators]);

  onMount(() => {
    refreshArchive();
    narratorsStatus()
      .then((s) => {
        cloudConfigured = !!s?.gemini?.configured;
        cloudNarrators = cloudConfigured ? s.gemini.models : [];
        if (narratorId.startsWith("gemini-") && !cloudNarrators.some((n) => n.id === narratorId)) {
          narratorId = DEFAULT_NARRATOR;
        }
      })
      .catch(() => { cloudConfigured = false; cloudNarrators = []; });
  });

  // Archivio partite: riesamina storie e tavole per scovare problemi.
  let archive = $state<StorySummary[]>([]);
  let openedId = $state<string | null>(null);
  let opened = $state<StoryDetail | null>(null);
  let archiveErr = $state("");

  const refreshArchive = async () => {
    try {
      archiveErr = "";
      archive = await listStories();
    } catch (e) {
      archiveErr = e instanceof Error ? e.message : String(e);
      archive = [];
    }
  };

  const toggleStory = async (id: string) => {
    if (openedId === id) {
      openedId = null;
      opened = null;
      return;
    }
    openedId = id;
    opened = null;
    try {
      opened = await getStory(id);
    } catch (e) {
      archiveErr = e instanceof Error ? e.message : String(e);
      openedId = null;
    }
  };

  const removeStory = async (id: string) => {
    try {
      await deleteStory(id);
      if (openedId === id) {
        openedId = null;
        opened = null;
      }
      await refreshArchive();
    } catch (e) {
      archiveErr = e instanceof Error ? e.message : String(e);
    }
  };

  const storyDate = (ts: number) => {
    try {
      return new Date(ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const canStart = $derived(genre && styleId && name.trim());

  const start = () => {
    if (!canStart) {
      hint =
        "Scegli un genere, uno stile grafico e un nome per il tuo personaggio.";
      return;
    }
    gameSession.genre = genre;
    gameSession.style = styleId;
    gameSession.name = name.trim();
    gameSession.model = modelId;
    gameSession.size = sizeId;
    gameSession.narrator = narratorId;
    saveSession();
    navigate(`/bandersketch/${encodeURIComponent(genre)}`);
  };
</script>

<div class="game-root">
  <div class="game-bar">
    <span class="game-brand"><span class="glyph">☾</span> Bandersketch</span>
  </div>
  <div class="setup-root">
    <button class="back-link" onclick={() => navigate("/")}>← officina</button>
    <section class="hist" aria-label="Bandersketch — setup">
      <Eyebrow>Giochi · Bandersketch</Eyebrow>
  <h1>Bandersketch</h1>
  <p class="lede">
    Una storia interattiva generata per te. Scegli il genere, lo stile grafico e
    il nome del tuo personaggio: poi entrerai in un sentiero dove ogni scelta è
    un enigma.
  </p>

  <SectionHead title="Genere" sub="Il mondo in cui inizia la storia." />
  <Panel
    style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem 1.5rem;"
  >
    {#each GENRES as g (g)}
      <Button variant="go" toggled={genre === g} onclick={() => (genre = g)}>
        {g}
      </Button>
    {/each}
  </Panel>

  <SectionHead
    title="Stile grafico"
    sub="Le illustrazioni seguiranno questo stile, fuso con l'estetica bonsai."
  />
  <Panel
    style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem 1.5rem;"
  >
    {#each STYLES as s (s.id)}
      <Button
        variant="go"
        toggled={styleId === s.id}
        onclick={() => (styleId = s.id)}
      >
        {s.label}
      </Button>
    {/each}
  </Panel>

  <SectionHead
    title="Il tuo personaggio"
    sub="Il nome che il protagonista porterà nella storia."
  />
  <Field label="Nome del personaggio">
    <input
      type="text"
      placeholder="es. Kael, Lyra, il Viandante…"
      maxlength="24"
      bind:value={name}
      onkeydown={(e) => e.key === "Enter" && start()}
    />
  </Field>

  <SectionHead
    title="Modello immagini"
    sub="Chi illustrerà la storia. Default: Z-Image."
  />
  <Panel
    style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem 1.5rem;"
  >
    {#each IMAGE_MODELS as m (m.id)}
      <Button
        variant="go"
        toggled={modelId === m.id}
        onclick={() => (modelId = m.id)}
        title={m.hint}
      >
        {m.label}
      </Button>
    {/each}
  </Panel>

  <SectionHead
    title="Risoluzione tavole"
    sub="Le illustrazioni nel libro occupano ~500px. Default: 512²."
  />
  <Panel
    style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem 1.5rem;"
  >
    {#each IMAGE_SIZES as s (s.id)}
      <Button
        variant="go"
        toggled={sizeId === s.id}
        onclick={() => (sizeId = s.id)}
        title={s.hint}
      >
        {s.label}
      </Button>
    {/each}
  </Panel>

  <SectionHead
    title="Narratore"
    sub="Chi racconta la storia. Default: Gemma 4 26B. Le voci cloud compaiono solo in modalità sviluppo (PALAMEDE_DEV=1 + chiave)."
  />
  <Panel
    style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem 1.5rem;"
  >
    {#each narratorOptions as n (n.id)}
      <Button
        variant="go"
        toggled={narratorId === n.id}
        onclick={() => (narratorId = n.id)}
        title={n.hint}
      >
        {n.label}
      </Button>
    {/each}
  </Panel>

  {#if !cloudConfigured}
    <p class="hintline">
      Narratore cloud (feature di sviluppo): imposta <code>PALAMEDE_DEV=1</code> e
      <code>PALAMEDE_GEMINI_API_KEY=…</code> nel file <code>.env</code> alla radice
      (copia <code>.env.example</code>), poi riavvia Palamede. Senza, si usano i
      narratori locali.
    </p>
  {/if}

  <div style="margin-top: 22px;">
    <Button variant="go" onclick={start} disabled={!canStart}>
      Entra nella storia →
    </Button>
  </div>

  <p class="hintline {hint ? 'err' : ''}" role="status">
    {hint || (canStart ? "pronto." : "completa le tre scelte.")}
  </p>
    </section>

    <section class="archive" aria-label="Archivio storie">
      <SectionHead
        title="Archivio storie"
        sub="Partite salvate con testi, scene e tavole: rileggile per scovare problemi."
      />
      {#if archiveErr}
        <p class="hintline err" role="status">archivio non raggiungibile: {archiveErr}</p>
      {:else if archive.length === 0}
        <p class="hintline" role="status">nessuna storia archiviata — gioca e torna qui.</p>
      {:else}
        {#each archive as s (s.id)}
          <article class="arc-item">
            <button class="arc-head" onclick={() => toggleStory(s.id)} aria-expanded={openedId === s.id}>
              <span class="arc-title">{s.genre || "?"} · {s.name || "?"}</span>
              <span class="arc-meta">{s.chapters} cap · {s.choices} scelte · {storyDate(s.updated)}</span>
              <span class="arc-meta">{s.narrator} · {s.painter}</span>
              <span class="arc-toggle">{openedId === s.id ? "−" : "+"}</span>
            </button>
            {#if openedId === s.id}
              {#if opened}
                {#each opened.chapters as c (c.n)}
                  <div class="arc-chap">
                    <p class="arc-chapnum">capitolo {c.n} · seme {c.seed}{c.rating === 1 ? " · 👍" : c.rating === -1 ? " · 👎" : ""}</p>
                    {#if c.img}
                      <img class="arc-thumb" src={storyImage(s.id, c.img)} alt={`Tavola capitolo ${c.n}`} loading="lazy" />
                    {/if}
                    <p class="arc-scene" title="Soggetto dato al pittore">soggetto: {c.scene}</p>
                    {#if c.prompt}
                      <details class="arc-prompt">
                        <summary>frammento che l'ha generato</summary>
                        <p class="arc-text">{c.prompt}</p>
                      </details>
                    {/if}
                    <p class="arc-text">{c.text}</p>
                  </div>
                {/each}
                {#each opened.forks as f (f.chapter)}
                  <div class="arc-fork">
                    <p class="arc-chapnum">bivio dopo cap. {f.chapter}{f.picked !== null ? ` → scelto ${f.picked === 0 ? "sinistra" : "destra"}` : " (non scelto)"}</p>
                    {#each f.options as o, k (k)}
                      <div class="arc-opt {f.picked === k ? 'picked' : ''}">
                        {#if o.img}
                          <img class="arc-thumb" src={storyImage(s.id, o.img)} alt={`Sentiero ${k + 1}`} loading="lazy" />
                        {/if}
                        <p class="arc-scene" title="Soggetto dato al pittore">soggetto: {o.scene} · seme {o.seed}</p>
                        <p class="arc-text">“{o.label}”</p>
                      </div>
                    {/each}
                  </div>
                {/each}
                <button class="arc-del" onclick={() => removeStory(s.id)}>elimina partita</button>
              {:else}
                <p class="hintline" role="status">caricamento…</p>
              {/if}
            {/if}
          </article>
        {/each}
      {/if}
    </section>
  </div>
</div>

<style>
  .archive { margin-top: 34px; }
  .arc-item {
    border: 1px solid var(--line);
    border-radius: 8px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .arc-head {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 12px 16px;
    text-align: left;
  }
  .arc-head:hover { background: rgba(201, 153, 94, 0.07); }
  .arc-title { font-size: 16px; }
  .arc-meta {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--paper-dim);
  }
  .arc-toggle { margin-left: auto; font-size: 18px; color: var(--accent); }
  .arc-chap, .arc-fork { padding: 12px 16px 4px; border-top: 1px dashed var(--line); }
  .arc-chapnum {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 8px;
  }
  .arc-thumb {
    width: min(320px, 100%);
    border-radius: 6px;
    display: block;
    margin-bottom: 8px;
  }
  .arc-scene { font-size: 12.5px; font-style: italic; color: var(--paper-dim); margin: 0 0 6px; }
  .arc-prompt { margin: 0 0 8px; }
  .arc-prompt summary {
    cursor: pointer;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--paper-dim);
  }
  .arc-prompt summary:hover { color: var(--accent); }
  .arc-text { font-size: 14.5px; line-height: 1.75; margin: 0 0 12px; white-space: pre-wrap; }
  .arc-opt { margin-bottom: 12px; }
  .arc-opt.picked .arc-text { color: var(--accent); }
  .arc-del {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--paper-dim);
    background: none;
    border: none;
    cursor: pointer;
    padding: 10px 16px 14px;
  }
  .arc-del:hover { color: #d98a8a; }
</style>
