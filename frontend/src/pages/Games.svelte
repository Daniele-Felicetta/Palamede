<script lang="ts">
  import { navigate } from '../router.svelte'
  import { Card, Eyebrow } from '../components/ui'

  // `embed` = montata dentro la pagina Extra: niente eyebrow/h1/lede propri.
  let { embed = false }: { embed?: boolean } = $props()

  // I giochi dell'officina: stesso formato a card della Home (glyph, titolo,
  // riga di piede). Aggiungere qui una voce per pubblicarne un altro.
  const GAMES = [
    {
      path: '/bandersketch',
      glyph: 'BND',
      title: 'BanderSketch',
      foot: 'Visual novel generativa · narratore locale',
    },
  ]
</script>

{#if !embed}
  <Eyebrow>Giochi · esperimenti interattivi</Eyebrow>
  <h1>Giochi</h1>
  <p class="lede">
    Esperimenti giocabili costruiti in officina, con i modelli locali come
    narratori.
  </p>
{/if}

<div class="grid-cards">
  {#each GAMES as g (g.path)}
    <Card
      live
      glyph={g.glyph}
      title={g.title}
      foot={g.foot}
      href={'#' + g.path}
      onclick={(e) => { e.preventDefault(); navigate(g.path) }}
    />
  {/each}
</div>
