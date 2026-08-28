import { ModelWiki } from '../data/wiki'

// Voce wiki di un modello: funzionamento, tabella specifiche, qualità,
// esempi reali generati dal modello stesso.
export function WikiEntry({ model }: { model: ModelWiki }) {
  return (
    <article className="wiki-entry" id={`wiki-${model.id}`}>
      <h3>
        {model.name} <span className="tag">{model.family}</span>
      </h3>
      <div className="wiki-body">
        {model.how.map((p, i) => <p key={i}>{p}</p>)}
      </div>

      <table className="spec-table">
        <tbody>
          {Object.entries(model.specs).map(([k, v]) => (
            <tr key={k}><th>{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="wiki-body" style={{ marginTop: 16 }}>
        {model.quality.map((p, i) => <p key={i}>— {p}</p>)}
      </div>

      <div className="ex-row">
        {model.examples.map((ex) => (
          <figure className="ex" key={ex.file}>
            <img
              src={`examples/${ex.file}`}
              alt={ex.prompt}
              loading="lazy"
            />
            <figcaption className="cap">
              “{ex.prompt}”
              <span className="m">{ex.note}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </article>
  )
}
