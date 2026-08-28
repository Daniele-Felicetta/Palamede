import { FormEvent, useEffect, useState } from 'react'
import { generateImage, getModels, selectModel, GenImage, ModelsStatus } from '../api'
import { IMAGE_MODELS } from '../data/wiki'
import { WikiEntry } from '../components/WikiEntry'

type ModelId = 'bonsai' | 'zimage'

const SIZES = [
  ['512x512', 'quadrata 1:1'],
  ['1024x1024', 'quadrata HD'],
  ['640x416', 'paesaggio 3:2'],
  ['1248x832', 'paesaggio 3:2 HD'],
  ['416x640', 'ritratto 2:3'],
] as const

const DEFAULT_STEPS: Record<ModelId, number> = { bonsai: 4, zimage: 8 }

interface Shot extends GenImage {
  model: ModelId
  prompt: string
  size: string
}

export function Images() {
  const [model, setModel] = useState<ModelId>('bonsai')
  const [loaded, setLoaded] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<ModelId | null>(null)
  const [prompt, setPrompt] = useState(
    'An icy bonsai tree in a rainy forest with a snowy mountain in the background, photo realistic')
  const [size, setSize] = useState<string>('512x512')
  const [steps, setSteps] = useState(4)
  const [seed, setSeed] = useState(-1)
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [error, setError] = useState(false)
  const [shots, setShots] = useState<Shot[]>([])

  useEffect(() => {
    getModels().then((m: ModelsStatus) => setLoaded(m.current)).catch(() => {})
  }, [])

  // selezione modello → carica dinamico sul server (un modello alla volta)
  const pickModel = async (m: ModelId) => {
    setModel(m)
    setSteps(DEFAULT_STEPS[m])
    if (loaded === m) return
    setSelecting(m)
    setHint(`caricamento ${m === 'bonsai' ? 'Bonsai' : 'Z-Image'} sulla GPU…`)
    try {
      const st = await selectModel(m)
      setLoaded(st.current)
      setHint('')
    } catch (err) {
      setHint(String(err instanceof Error ? err.message : err))
      setError(true)
    } finally {
      setSelecting(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || busy || selecting) return
    setBusy(true); setError(false); setHint('in coda sulla GPU…')
    const [w, h] = size.split('x').map(Number)
    try {
      // assicura che il modello giusto sia caricato
      if (loaded !== model) {
        setHint(`caricamento ${model}…`)
        const st = await selectModel(model)
        setLoaded(st.current)
      }
      const t0 = performance.now()
      const imgs = await generateImage({ model, prompt: prompt.trim(), steps, seed, width: w, height: h, count })
      setShots((prev) => [
        ...imgs.map((im) => ({ ...im, model, prompt: prompt.trim(), size })),
        ...prev,
      ])
      const secs = ((performance.now() - t0) / 1000).toFixed(1)
      setHint(`fatto: ${imgs.length}×${size} in ${secs} s (attesa coda inclusa)`)
    } catch (err) {
      setHint(String(err instanceof Error ? err.message : err))
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const plateState = (id: ModelId) => {
    if (selecting === id) return '…carico'
    if (loaded === id) return 'attivo'
    return 'a riposo'
  }

  return (
    <>
      <p className="eyebrow">Sezione immagini</p>
      <h1>Due modelli, <em>una GPU</em>.</h1>
      <p className="lede">
        Bonsai (4B ternario, 4 step) e Z-Image Turbo (6B, 8 step) condividono la
        scheda: selezioni un modello e viene <strong>caricato al momento</strong>,
        liberando la VRAM quando passi all'altro. Sotto, la wiki dei due modelli
        con esempi generati ora.
      </p>

      <section>
        <div className="gen-wrap">
          <form className="panel" onSubmit={submit}>
            <div className="plates" role="radiogroup" aria-label="Modello">
              {IMAGE_MODELS.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`plate ${model === m.id ? 'sel' : ''}`}
                  onClick={() => pickModel(m.id as ModelId)}
                >
                  <span className="pname">
                    <span className={`led ${loaded === m.id ? 'on' : selecting === m.id ? 'busy' : 'off'}`} aria-hidden />
                    {m.name}
                  </span>
                  <span className="pstamps">
                    <span className="stamp">{m.family}</span>
                    <span className="stamp hot">{m.id === 'bonsai' ? '4 step · 1.58-bit' : '8 step · Q4_K_M'}</span>
                  </span>
                  <span className="pdown">
                    {plateState(m.id as ModelId)} ·
                    {m.id === 'bonsai'
                      ? ' 512² in 1.8 s — il più veloce'
                      : ' testo nell\'immagine, fotorealismo spinto'}
                  </span>
                </button>
              ))}
            </div>

            <textarea
              className="prompt-box"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Descrivi l'immagine…"
              aria-label="Prompt"
            />

            <div className="field-row">
              <div className="field">
                <label htmlFor="size">Formato</label>
                <select id="size" value={size} onChange={(e) => setSize(e.target.value)}>
                  {SIZES.map(([v, lab]) => (
                    <option key={v} value={v}>{v} · {lab}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="steps">Step</label>
                <input id="steps" type="number" min={1} max={20}
                  value={steps} onChange={(e) => setSteps(Number(e.target.value) || 1)} />
              </div>
              <div className="field">
                <label htmlFor="seed">Seed</label>
                <input id="seed" type="number" min={-1} step={1}
                  value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="count">Copie</label>
                <input id="count" type="number" min={1} max={4}
                  value={count} onChange={(e) => setCount(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} />
              </div>
            </div>

            <button className="go" type="submit" disabled={busy || !!selecting || !prompt.trim()}>
              {selecting ? 'caricamento…' : busy ? 'in lavorazione…' : 'Genera'}
            </button>
            <p className={`hintline ${error ? 'err' : ''}`} role="status">{hint}</p>
          </form>

          <aside>
            {shots.length === 0 ? (
              <div className="empty">
                Nessun esito in questa sessione.<br />Scrivi un prompt, premi Genera.
              </div>
            ) : (
              <div className="gallery">
                {shots.map((s, i) => (
                  <figure className="shot" key={s.model + '-' + s.seed + '-' + i}>
                    <img src={s.dataUrl} alt={s.prompt} />
                    <figcaption className="meta">
                      <div className="who">{s.model === 'bonsai' ? 'Bonsai' : 'Z-Image'} · {s.size}</div>
                      <p>“{s.prompt}”</p>
                      <div className="nums">
                        {(s.timeMs / 1000).toFixed(1)} s · seed {s.seed} · {s.params.steps as number} step
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="wiki">
        <h2 className="sec-title">Wiki · modelli immagini</h2>
        <p className="sec-sub">
          Come funzionano, quanto occupano, quanto tempo mettono (misurato su
          questa macchina) e cosa rendono. Esempi prodotti dai modelli stessi.
        </p>
        {IMAGE_MODELS.map((m) => <WikiEntry key={m.id} model={m} />)}
      </section>
    </>
  )
}