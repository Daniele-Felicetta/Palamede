import { useStore } from '../store'
import { useHashRoute } from '../router'

const SECTIONS = [
  {
    path: '/images', glyph: 'IMG', title: 'Immagini',
    text: 'Due generatori: Bonsai 4B ternary (velocissimo) e Z-Image Turbo Q4 (qualità e testo nell\'immagine).',
    live: true,
    foot: '2 modelli installati · Bonsai + Z-Image',
  },
  {
    path: '/text', glyph: 'TXT', title: 'Testo',
    text: 'Chat e completamento con LLM GGUF locali (llama.cpp / Ollama).',
    live: false,
    foot: 'nessun GGUF in models/',
  },
  {
    path: '/video', glyph: 'VID', title: 'Video',
    text: 'Text-to-video (Wan/LTX) sullo stesso engine che già serve Z-Image.',
    live: false,
    foot: 'engine pronto · pesi mancanti',
  },
  {
    path: '/3d', glyph: '3D', title: '3D',
    text: 'Mesh con texture da descrizione: TRELLIS, Hunyuan3D.',
    live: false,
    foot: 'motore e modelli da installare',
  },
  {
    path: '/rag', glyph: 'RAG', title: 'RAG',
    text: 'Interroga i tuoi documenti con embedding e vettore locale, tutto offline.',
    live: false,
    foot: 'serve un modello embeddings',
  },
  {
    path: '/mcp', glyph: 'MCP', title: 'MCP',
    text: 'Gli strumenti dell\'officina esposti come server MCP per gli agenti.',
    live: false,
    foot: 'primo strumento al rilascio immagini',
  },
]

export function Home() {
  const [, navigate] = useHashRoute()
  const { health, current, modelLabel, metrics } = useStore()
  const gpuOk = metrics?.gpu.ok
  const gpuPct = gpuOk ? metrics!.gpu.utilPct : 0

  return (
    <>
      <header className="home-hero">
        <p className="eyebrow">Officina locale di generazione</p>
        <h1>I modelli stanno qui.<br />Sulla tua <em>GPU</em>, non nel cloud.</h1>
        <p className="lede">
          Palamede raccoglie i generatori che giri in casa: un hub, una coda, una
          wiki per tipo di modello — come funziona, quanto pesa, quanto
          ci mette, quanto rende, con esempi prodotti dai modelli stessi.
        </p>

        <div className="hero-chips" aria-label="Fatti dell'officina">
          <span>RTX 5060 Ti · 16 GB</span>
          <span>un modello alla volta</span>
          <span>tutto offline</span>
        </div>

        <div className="log-strip" role="status" aria-label="Stato dell'officina">
          <span className="log-led">
            <span className={`led ${health?.ok ? 'on' : 'off'}`} aria-hidden />
            {health?.ok ? 'officina accesa' : 'officina spenta'}
          </span>
          <span className="log-model">
            in VRAM: {current ? modelLabel(current) : 'nessuno'}
          </span>
          <span className="log-gpu">
            <span className="log-bar" aria-hidden>
              <span className="log-fill" style={{ width: `${Math.min(100, gpuPct)}%` }} />
            </span>
            GPU {gpuOk ? `${gpuPct}%` : 'n/d'}
          </span>
        </div>
      </header>

      <section aria-label="Applicazioni" className="apps">
        <h2 className="sec-title">Le applicazioni</h2>
        <p className="sec-sub">
          Sei banchi di lavoro; uno è già acceso. Le bozze portano la loro wiki e
          la lista di cosa serve per metterle in moto.
        </p>
        <div className="grid-cards">
          {SECTIONS.map((s) => (
            <a
              key={s.path}
              className={`card ${s.live ? 'live-card' : ''}`}
              href={'#' + s.path}
              onClick={(e) => { e.preventDefault(); navigate(s.path) }}
            >
              <span className={`state ${s.live ? 'live' : 'bozza'}`}>
                {s.live ? 'attiva' : 'bozza'}
              </span>
              <span className="glyph">{s.glyph}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <span className="app-foot">{s.foot}</span>
            </a>
          ))}
        </div>
      </section>

      <section aria-label="Misure" className="bench">
        <h2 className="sec-title">Misure sul banco</h2>
        <p className="sec-sub">
          Tempi reali presi su questa macchina, GPU dedicata, warm (cache JIT
          già scaldata). Il primo colpo a una nuova risoluzione paga qualche
          secondo in più.
        </p>
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
    </>
  )
}