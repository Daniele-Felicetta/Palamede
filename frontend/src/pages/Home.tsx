import { useHashRoute } from '../router'

const SECTIONS = [
  {
    path: '/images', glyph: 'IMG', title: 'Immagini',
    text: 'Due generatori: Bonsai 4B ternary (velocissimo) e Z-Image Turbo Q4 (qualità e testo nell\'immagine).',
    live: true,
  },
  { path: '/text', glyph: 'TXT', title: 'Testo', text: 'Chat e completamento con LLM GGUF locali (llama.cpp / Ollama).', live: false },
  { path: '/video', glyph: 'VID', title: 'Video', text: 'Text-to-video (Wan/LTX) sullo stesso engine che già serve Z-Image.', live: false },
  { path: '/3d', glyph: '3D', title: '3D', text: 'Mesh con texture da descrizione: TRELLIS, Hunyuan3D.', live: false },
  { path: '/rag', glyph: 'RAG', title: 'RAG', text: 'Interroga i tuoi documenti con embedding e vettore locale, tutto offline.', live: false },
  { path: '/mcp', glyph: 'MCP', title: 'MCP', text: 'Gli strumenti dell\'officina esposti come server MCP per gli agenti.', live: false },
]

export function Home() {
  const [, navigate] = useHashRoute()
  return (
    <>
      <p className="eyebrow">Officina locale di generazione</p>
      <h1>I modelli stanno qui.<br />Sulla tua <em>GPU</em>, non nel cloud.</h1>
      <p className="lede">
        Palamede raccoglie i generatori che giri in casa: un hub, una coda, una
        wiki per tipo di modello — come funziona, quanto pesa, quanto
        ci mette, quanto rende, con esempi prodotti dai modelli stessi.
      </p>

      <section aria-label="Misure">
        <p className="eyebrow">misurato su RTX 5060 Ti 16GB · GPU dedicata</p>
        <div className="gauge">
          <div className="cell">
            <div className="num">1.8<small> s</small></div>
            <div className="lab">Bonsai · 512² · 4 step</div>
          </div>
          <div className="cell">
            <div className="num">3.3<small> s</small></div>
            <div className="lab">Z-Image · 512² · 8 step</div>
          </div>
          <div className="cell">
            <div className="num">6.4<small> s</small></div>
            <div className="lab">Bonsai · 1024² · 4 step</div>
          </div>
          <div className="cell">
            <div className="num">17.8<small> s</small></div>
            <div className="lab">Z-Image · 1024² · 8 step</div>
          </div>
          <div className="cell">
            <div className="num">6–8.5<small> GB</small></div>
            <div className="lab">VRAM per modello</div>
          </div>
        </div>
      </section>

      <section aria-label="Sezioni">
        <h2 className="sec-title">Le banchine</h2>
        <p className="sec-sub">Sei sezioni; una è già operativa. Le bozze portano la loro wiki e la lista di cosa serve per accenderle.</p>
        <div className="grid-cards">
          {SECTIONS.map((s) => (
            <a
              key={s.path}
              className="card"
              href={'#' + s.path}
              onClick={(e) => { e.preventDefault(); navigate(s.path) }}
            >
              <span className={`state ${s.live ? 'live' : 'bozza'}`}>
                {s.live ? 'attiva' : 'bozza'}
              </span>
              <span className="glyph">{s.glyph}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </a>
          ))}
        </div>
      </section>
    </>
  )
}
