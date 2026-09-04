<script lang="ts">
  import { navigate } from "../router.svelte";
  import { Card } from "../components/ui";

  let s = {
    live: true,
    path: "/bandersketch",
    glyph: "🎮",
    title: "BanderSketch",
    foot: "Esplora i nostri giochi",
  };
</script>

<section class="apps" aria-label="Applicazioni">
  <div class="grid-cards">
    <Card
      live={s.live}
      glyph={s.glyph}
      title={s.title}
      foot={s.foot}
      href={"#" + s.path}
      onclick={(e) => {
        e.preventDefault();
        navigate(s.path);
      }}
    />
  </div>
</section>
