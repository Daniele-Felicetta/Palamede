<script lang="ts">
  import { Button } from "../components/ui";
  import Shot from "../components/Shot.svelte";
  import { generateQuick, generateQuickText, type GenImage } from "../api";

  const PROMPT =
    "Un paesaggio fantastico con montagne e 7 laghi, in stile bonsai, colori vivaci, dettagli intricati, 512x512";

  // Generi disponibili: i bottoni vengono generati da questo array.
  const GENRES = [
    "Fantascienza",
    "Fattoria Comica",
    "Giallo",
    "Horror",
    "Fantasy",
    "Avventura",
  ];

  let im = $state<GenImage | null>(null);
  let story = $state("");
  let hint = $state("");
  let busy = $state(false);

  const play = async (genre: string) => {
    if (busy) return;
    busy = true;
    hint = "";
    story = "";
    try {
      await generateQuickText(
        `Scrivi una storia breve di genere "${genre}". Ambientazione, personaggi e un colpo di scena finale.`,
        { onDelta: (t) => (story += t) },
      );
      [im] = await generateQuick(PROMPT);
    } catch (e) {
      hint = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  };
</script>

<section class="hist" aria-label="Gioco Bandersketch">
  <section class="intro">
    <h1>Bandersketch</h1>
    <h3>
      Questa sarà una storia incredibile: bandersketch è un gioco in cui viene
      generata una storia a partire da un genere. Scegli il tipo di storia che
      vuoi generare e premi il pulsante per vedere il risultato. Buon
      divertimento!
    </h3>
  </section>
  <br />
  <div class="shot-actions">
    {#each GENRES as g (g)}
      <Button variant="go" onclick={() => play(g)} disabled={busy}>
        {g}
      </Button>
    {/each}
  </div>

  {#if story}
    <div style="white-space: pre-wrap">{story}</div>
  {/if}

  {#if im}
    <div class="gallery">
      <Shot
        src={im.dataUrl}
        title={PROMPT}
        model="Bonsai"
        size="1024x1024"
        timeMs={im.timeMs}
        seed={im.seed}
      />
    </div>
  {/if}

  <p class="hintline {hint ? 'err' : ''}" role="status">
    {hint || (busy ? "genero…" : "")}
  </p>
</section>
