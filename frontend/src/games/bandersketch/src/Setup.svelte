<script lang="ts">
  import { navigate } from "../../../router.svelte";
  import {
    Button,
    Eyebrow,
    Field,
    Panel,
    SectionHead,
  } from "../../../components/ui";
  import { GENRES, STYLES, IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from "./data";
  import { gameSession } from "./session.svelte";

  let genre = $state("");
  let styleId = $state("");
  let name = $state("Gino");
  let modelId = $state(DEFAULT_IMAGE_MODEL);
  let hint = $state("");

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
    navigate(`/bandersnatch/${encodeURIComponent(genre)}`);
  };
</script>

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

  <div style="margin-top: 22px;">
    <Button variant="go" onclick={start} disabled={!canStart}>
      Entra nella storia →
    </Button>
  </div>

  <p class="hintline {hint ? 'err' : ''}" role="status">
    {hint || (canStart ? "pronto." : "completa le tre scelte.")}
  </p>
</section>
