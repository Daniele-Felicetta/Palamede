import { FormEvent, useEffect, useState } from 'react'
import { generateImage, getHistory, saveHistory, clearHistory, historyImgUrl, HistoryEntry } from '../api'
import { refreshModels, switchModel, useStore } from '../store'
import { IMAGE_MODELS } from '../data/wiki'
import { WikiEntry } from '../components/WikiEntry'

type ModelId = 'bonsai' | 'zimage'

const SIZES = [
  ['512x512', 'quadrata 1:1'],
  ['768x768', 'quadrata media'],
  ['896x896', 'quadrata alta'],
  ['1024x1024', 'quadrata HD'],
  ['640x416', 'paesaggio 3:2'],
  ['768x512', 'paesaggio 3:2 media'],
  ['1248x832', 'paesaggio 3:2 HD'],
  ['416x640', 'ritratto 2:3'],
  ['512x768', 'ritratto 2:3 media'],
  ['832x1248', 'ritratto 2:3 HD'],
] as const

const DEFAULT_STEPS: Record<ModelId, number> = { bonsai: 4, zimage: 8 }

export function Images() {
  const { current, selecting } = useStore()
  const [model, setModel] = useState<ModelId>('bonsai')
  const [prompt, setPrompt] = useState(
    'An icy bonsai tree in a rainy forest with a snowy mountain in the background, photo realistic')
  const [size, setSize] = useState<string>('512x512')
  const [steps, setSteps] = useState(4)
  const [seed, setSeed] = useState(-1)
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [error, setError] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [clearing, setClearing] = useState(false)

  // cronologia persistente su disco (outputs/history) tramite hub
  useEffect(() => {
    getHistory().then(setHistory).catch(() => setHistory([]))
  }, [])

  const reload = async () => {
    try { setHistory(await getHistory()) } catch { /* il prossimo giro */ }
  }

  const pickModel = async (m: ModelId) => {
    if (selecting) return
    setModel(m)
    setSteps(DEFAULT_STEPS[m])
    if (current === m) return
    setHint(`caricamento ${m === 'bonsai' ? 'Bonsai' : 'Z-Image'} sulla GPU…`)
    try {
      await switchModel(m)
      setHint('')
    } catch (err) {
      setHint(String(err instanceof Error ? err.message : err))
      setError(true)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || busy || selecting) return
    setBusy(true); setError(false); setHint('in coda sulla GPU…')
    const [w, h] = size.split('x').map(Number)
    try {
      if (current !== model) {
        setHint(`caricamento ${model} sulla GPU…`)
        await switchModel(model)
      }
      const t0 = performance.now()
      const imgs = await generateImage({ model, prompt: prompt.trim(), steps, seed, width: w, height: h, count })
      // salva in cronologia (un file per immagine) e rilegge la lista
      for (const im of imgs) {
        try {
          await saveHistory({
            model, prompt: prompt.trim(), size,
            seed: im.seed, steps, timeMs: im.timeMs, dataUrl: im.dataUrl,
          })
        } catch { /* cronologia best-effort */ }
      }
      await reload()
      const secs = ((performance.now() - t0) / 1000).toFixed(1)
      setHint(`fatto: ${imgs.length}×${size} in ${secs} s (attesa coda inclusa)`)
      refreshModels()
    } catch (err) {
      setHint(String(err instanceof Error ? err.message : err))
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const reuse = (s: HistoryEntry) => {
    setModel(s.model as ModelId)
    setSteps(DEFAULT_STEPS[s.model as ModelId] || s.steps)
    if (SIZES.some(([v]) => v === s.size)) setSize(s.size)
    setSeed(s.seed)
    setPrompt(s.prompt)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const copyPrompt = async (s: HistoryEntry) => {
    try { await navigator.clipboard.writeText(s.prompt); setHint('prompt copiato') } catch { /* no clipboard */ }
  }

  const wipe = async () => {
    setClearing(true)
    try {
      await clearHistory()
      setHistory([])
      setHint('cronologia svuotata')
    } catch (err) {
      setHint(String(err instanceof Error ? err.message : err))
      setError(true)
    } finally {
      setClearing(false)
    }
  }

  const plateState = (id: ModelId) => {
    if (selecting === id) return '…carico'
    if (current === id) return 'attivo'
    return 'a riposo'
  }

  return (
    <>
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
                  <span className={`led ${current === m.id ? 'on' : selecting === m.id ? 'busy' : 'off'}`} aria-hidden />
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

        <section className="hist" aria-label="Cronologia">
          <div className="hist-head">
            <div>
              <p className="eyebrow">Cronologia</p>
              <h2 className="sec-title">Ultime generazioni</h2>
            </div>
            {history.length > 0 && (
              <button type="button" className="side-toggle" onClick={wipe} disabled={clearing}>
                {clearing ? 'svuoto…' : `svuota (${history.length})`}
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="empty">
              Nessuna generazione salvata.<br />Genera un'immagine: finisce qui, persistente tra una sessione e l'altra.
            </div>
          ) : (
            <div className="gallery">
              {history.map((s) => (
                <figure className="shot" key={s.id}>
                  <a href={historyImgUrl(s.id)} target="_blank" rel="noreferrer" title="apri a schermo intero">
                    <img src={historyImgUrl(s.id)} alt={s.prompt} loading="lazy" />
                  </a>
                  <figcaption className="meta">
                    <div className="who">{s.model === 'bonsai' ? 'Bonsai' : 'Z-Image'} · {s.size}</div>
                    <p title={s.prompt}>“{s.prompt}”</p>
                    <div className="nums">
                      {(s.timeMs / 1000).toFixed(1)} s · seed {s.seed} · {s.steps} step
                    </div>
                    <div className="shot-actions">
                      <button type="button" onClick={() => reuse(s)} title="Riporta modello, prompt e parametri nel pannello">riusa</button>
                      <button type="button" onClick={() => copyPrompt(s)} title="Copia il prompt negli appunti">copia</button>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>

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