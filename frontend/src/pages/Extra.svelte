<script lang="ts">
  // Pagina Extra: le sezioni di contorno (Progetto, Experimental, Giochi) in
  // un'unica pagina ordinata — una testata, una nav interna e tre blocchi
  // etichettati. Le pagine originali restano auto-routate (/progetto,
  // /experimental, /games) ma fuori dalla nav; qui sono montate in modalità
  // `embed` (senza ripetere eyebrow/h1/lede).
  import { Eyebrow } from '../components/ui'
  import Progetto from './Progetto.svelte'
  import Bench from './Bench.svelte'
  import Experimental from './Experimental.svelte'
  import Games from './Games.svelte'

  const BLOCKS = [
    { id: 'extra-progetto', label: 'Progetto' },
    { id: 'extra-banco', label: 'Banco di prova' },
    { id: 'extra-experimental', label: 'Experimental' },
    { id: 'extra-giochi', label: 'Giochi' },
  ]

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }
</script>

<Eyebrow>Extra · documentazione, prove e giochi</Eyebrow>
<h1>Extra</h1>
<p class="lede">
  Le sezioni di contorno dell'officina: la documentazione del progetto, il
  banco di prova dei modelli, il registro delle sperimentazioni e i giochi.
</p>

<nav class="extra-nav" aria-label="Sezioni Extra">
  {#each BLOCKS as b (b.id)}
    <button type="button" onclick={() => jump(b.id)}>{b.label}</button>
  {/each}
</nav>

<section class="extra-block" id="extra-progetto" aria-labelledby="extra-progetto-title">
  <header class="extra-block-head">
    <Eyebrow>Progetto · documentazione</Eyebrow>
    <h2 class="extra-block-title" id="extra-progetto-title">Il progetto</h2>
    <p class="sec-sub">
      Mappa di struttura, README operativo, specifica tecnica e sicurezza: la
      documentazione dell'officina, qui dentro.
    </p>
  </header>
  <Progetto embed />
</section>

<section class="extra-block" id="extra-banco" aria-labelledby="extra-banco-title">
  <header class="extra-block-head">
    <Eyebrow>Banco di prova · modelli testuali e immagine</Eyebrow>
    <h2 class="extra-block-title" id="extra-banco-title">Banco di prova</h2>
    <p class="sec-sub">
      Qualità e velocità dei modelli testuali e dei generatori di immagini,
      misurate su questa macchina: tabella completa, classifiche, galleria.
    </p>
  </header>
  <Bench embed />
</section>

<section class="extra-block" id="extra-experimental" aria-labelledby="extra-experimental-title">
  <header class="extra-block-head">
    <Eyebrow>Experimental · registro delle prove</Eyebrow>
    <h2 class="extra-block-title" id="extra-experimental-title">Experimental</h2>
    <p class="sec-sub">
      Cosa abbiamo provato e perché si è fermata, e cosa stiamo provando adesso —
      con cosa manca da sistemare e i rischi che restano.
    </p>
  </header>
  <Experimental embed />
</section>

<section class="extra-block" id="extra-giochi" aria-labelledby="extra-giochi-title">
  <header class="extra-block-head">
    <Eyebrow>Giochi · esperimenti interattivi</Eyebrow>
    <h2 class="extra-block-title" id="extra-giochi-title">Giochi</h2>
    <p class="sec-sub">
      Esperimenti giocabili costruiti in officina, con i modelli locali come
      narratori.
    </p>
  </header>
  <Games embed />
</section>
