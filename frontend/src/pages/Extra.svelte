<script lang="ts">
  // Pagina Extra: raccoglie le sezioni di contorno (Progetto, Experimental,
  // Giochi) in un'unica pagina, impilate. Le pagine originali restano
  // auto-routate (/progetto, /experimental, /games) ma fuori dalla nav.
  import { Eyebrow } from '../components/ui'
  import Progetto from './Progetto.svelte'
  import Experimental from './Experimental.svelte'
  import Games from './Games.svelte'
</script>

<Eyebrow>Extra · documentazione, prove e giochi</Eyebrow>
<p class="lede">
  Le sezioni di contorno dell'officina: la documentazione del progetto, il
  registro delle sperimentazioni e i giochi.
</p>

<div class="extra-stack">
  <Progetto />
  <hr class="extra-sep" />
  <Experimental />
  <hr class="extra-sep" />
  <Games />
</div>
