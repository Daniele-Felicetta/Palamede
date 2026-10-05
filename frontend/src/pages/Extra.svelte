<script lang="ts">
  // Pagina Extra: la MENU di contorno dell'officina, in stile "Netflix" —
  // invece di impilare i blocchi di sotto, una lista di scaffali (shelves)
  // di card che portano alla pagina vera. Ogni scheda resta auto-routata
  // (/progetto, /bench, /experimental, /games, /swarm…): qui si sceglie, non
  // si scorre.
  //
  // Le card sono <a href="#/rotta"> vere (middle-click, copia link, apertura
  // in nuova scheda funzionano); onclick solo lo smooth-scroll interno.
  import { navigate } from '../router.svelte'
  import { Eyebrow, SectionHead } from '../components/ui'

  interface Tile {
    path: string
    glyph: string
    title: string
    foot: string
    live: boolean
    wide?: boolean
  }

  interface Shelf {
    id: string
    title: string
    sub: string
    items: Tile[]
  }

  // Scaffali: solo il contorno dell'officina (le app operative restano nella
  // Home e nella sidebar): prove, laboratorio, documentazione, giochi.
  const SHELVES: Shelf[] = [
    {
      id: 'extra-prove',
      title: 'Prove e misure',
      sub: 'Il banco di prova e i prototipi: dove i numeri e le demo si misurano davvero.',
      items: [
        { path: '/bench', glyph: 'BNC', title: 'Banco di prova', foot: 'qualità e velocità · modelli e immagini', live: true, wide: true },
        { path: '/swarm', glyph: 'SWM', title: 'Stormo di agenti', foot: '3 x MiniCPM5 2B in parallelo', live: true, wide: true },
      ],
    },
    {
      id: 'extra-laboratorio',
      title: 'Laboratorio',
      sub: 'Prove accantonate e lavori in corso: cosa stiamo tentando e cosa manca.',
      items: [
        { path: '/observatory', glyph: 'OBS', title: 'Osservatorio neurale', foot: 'LFM2.5 230M allenato dal vivo, in 3D', live: true },
        { path: '/experimental', glyph: 'EXP', title: 'Experimental', foot: 'registro TRIED / WIP', live: true },
        { path: '/mcp', glyph: 'MCP', title: 'MCP', foot: 'bozza — server MCP stdio', live: false },
      ],
    },
    {
      id: 'extra-docs',
      title: 'Documentazione',
      sub: 'La carta dell\'officina: mappa, README, specifica e sicurezza.',
      items: [
        { path: '/progetto', glyph: 'PRG', title: 'Progetto', foot: 'MAPPA · README · SPEC · SECURITY', live: true, wide: true },
      ],
    },
    {
      id: 'extra-giochi',
      title: 'Giochi',
      sub: 'Esperimenti giocabili costruiti in officina, con i modelli locali come narratori.',
      items: [
        { path: '/games', glyph: 'GIO', title: 'Giochi', foot: 'esperimenti interattivi', live: true },
        { path: '/bandersketch', glyph: 'BND', title: 'Bandersketch', foot: 'visual novel generativa', live: true },
      ],
    },
  ]
</script>

<Eyebrow>Extra · il menu di contorno</Eyebrow>
<h1>Extra</h1>
<p class="lede">
  Tutto quello che sta ai bordi dell'officina, in schede: le prove, la
  documentazione, il laboratorio e i giochi. Scegli e ci vai.
</p>

<div class="extra-menu">
  {#each SHELVES as shelf (shelf.id)}
    <section class="shelf" aria-label={shelf.title}>
      <SectionHead title={shelf.title} sub={shelf.sub} />
      <div class="rail">
        {#each shelf.items as t (t.path)}
          <a
            class="poster"
            class:wide={t.wide}
            href={'#' + t.path}
            aria-label={`${t.title} — ${t.foot}`}
            onclick={(e) => { e.preventDefault(); navigate(t.path) }}
          >
            <span class={`state ${t.live ? 'live' : 'bozza'}`}>{t.live ? 'attiva' : 'bozza'}</span>
            <span class="poster-glyph">{t.glyph}</span>
            <span class="poster-body">
              <h3>{t.title}</h3>
              <span class="poster-foot">{t.foot}</span>
            </span>
          </a>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .extra-menu { display: flex; flex-direction: column; gap: 30px; margin-top: 8px; }

  /* Scaffallo orizzontale scorrevole, tipo Netflix: snap + corsie larghe. */
  .rail {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding: 4px 4px 10px;
    margin: -4px -4px 0;
    scrollbar-width: thin;
  }
  .poster { flex: 0 0 214px; }
  .poster.wide { flex-basis: 330px; }

  .poster {
    scroll-snap-align: start;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 10px;
    min-height: 190px;
    padding: 16px;
    text-decoration: none;
    color: var(--paper);
    background:
      radial-gradient(120% 90% at 100% 0%, rgba(139, 147, 255, .16), transparent 60%),
      var(--ink-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    transition: border-color .15s, transform .15s, box-shadow .15s;
  }
  .poster:hover {
    border-color: var(--accent);
    transform: translateY(-4px);
    box-shadow: var(--shadow);
  }
  .poster-glyph {
    font-family: var(--mono);
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 2px;
    color: var(--accent);
    line-height: 1;
  }
  .poster-body h3 {
    font-family: var(--display);
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 3px;
  }
  .poster-foot {
    display: block;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--paper-dim);
  }
  .poster .state {
    position: absolute;
    top: 12px;
    right: 12px;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 1px;
    padding: 3px 8px;
    border-radius: 20px;
    text-transform: uppercase;
  }
  @media (prefers-reduced-motion: reduce) {
    .poster { transition: none; }
    .poster:hover { transform: none; }
  }
</style>