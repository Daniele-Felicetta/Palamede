import { DraftWiki } from '../data/wiki'

// Pagina-bozza: wiki del tipo di modello + cosa serve per accenderlo.
export function Draft({ draft }: { draft: DraftWiki }) {
  return (
    <>
      <p className="eyebrow">Sezione {draft.glyph} · bozza</p>
      <h1>{draft.title}</h1>
      <p className="lede">{draft.tagline}</p>

      <div className="bozza-note">
        <strong>Stato:</strong> {draft.specs['Stato']}
      </div>

      <section className="wiki" style={{ marginTop: 34 }}>
        <article className="wiki-entry">
          <h3>Come funziona <span className="tag">{draft.glyph}</span></h3>
          <div className="wiki-body">
            {draft.how.map((p, i) => <p key={i}>{p}</p>)}
          </div>

          <table className="spec-table">
            <tbody>
              {Object.entries(draft.specs).map(([k, v]) => (
                <tr key={k}><th>{k}</th><td>{v}</td></tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 28 }}>Cosa manca per accenderla</h3>
          <div className="wiki-body">
            {draft.needs.map((n) => <p key={n}>— {n}</p>)}
          </div>
        </article>
      </section>
    </>
  )
}
