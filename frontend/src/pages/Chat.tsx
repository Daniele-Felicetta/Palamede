import { FormEvent, useEffect, useRef, useState } from 'react'
import { chatStream, ChatMessage, ChatStatus, getChatStatus, startChat, stopChat } from '../api'
import { ORNITH_MODELS, ORNITH_WIKI } from '../data/wiki'
import { WikiEntry } from '../components/WikiEntry'
import { Markdown } from '../components/Markdown'

const KV_OPTIONS = [
  ['q8_0', 'q8_0 · consigliato'],
  ['q4_0', 'q4_0 · più veloce, qualità ok'],
  ['f16', 'off · massima precisione'],
] as const

const DEFAULT = {
  context: 8192,
  kv: 'q8_0',
  mtp: false,
  cpuMoe: 0,
  gpuLayers: 99,
  temperature: 0.7,
}

interface StreamStats { tps: number; tokens: number }

function streamText(
  body: ReadableStream<Uint8Array>,
  onDelta: (type: 'reason' | 'content', t: string) => void,
  onDone: (stats?: StreamStats) => void,
  onErr: (e: Error) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const pump = (): void => {
    reader.read().then(({ done, value }) => {
      if (done) { onDone(); return }
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') { onDone(); return }
        try {
          const j = JSON.parse(data)
          const d = j?.choices?.[0]?.delta
          if (d) {
            // Ornith è un modello reasoning: prima i token di pensiero,
            // poi la risposta vera.
            if (typeof d.reasoning_content === 'string' && d.reasoning_content) onDelta('reason', d.reasoning_content)
            else if (typeof d.content === 'string' && d.content) onDelta('content', d.content)
            continue
          }
          // chunk finale: llama-server ci dà i timings precisi
          const t = j?.timings
          if (t && typeof t.predicted_per_second === 'number') {
            onDone({ tps: t.predicted_per_second, tokens: t.predicted_n ?? 0 })
            return
          }
        } catch { /* eventi non JSON ignorati */ }
      }
      pump()
    }).catch((e) => onErr(e instanceof Error ? e : new Error(String(e))))
  }
  pump()
}

interface Msg extends ChatMessage { pending?: boolean; reason?: string }

// Ragionamento pieghevole: resta aperto durante lo streaming, poi l'utente
// decide (ogni messaggio con il proprio stato).
function ReasonBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (streaming) setOpen(true) }, [streaming])
  return (
    <details className="reason" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>ragionamento</summary>
      <div className="reason-text">{text}</div>
    </details>
  )
}

export function Chat() {
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [model, setModel] = useState('ornith-9b')
  const [settings, setSettings] = useState(DEFAULT)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  // contatore tok/s: stima live durante la generazione, preciso a fine stream
  const [stats, setStats] = useState<{ tps: number; tokens: number | null; live: boolean } | null>(null)
  const genStart = useRef(0)
  const charsRef = useRef(0)

  // autoscroll "intelligente": segue la generazione solo se l'utente è già
  // in fondo, altrimenti resta dove sta (niente salti mentre legge).
  const logRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const refresh = async () => {
    try { setStatus(await getChatStatus()) } catch { setStatus(null) }
  }
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onLogScroll = () => {
    const el = logRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }

  const selected = status?.models?.find((m) => m.id === model)

  const apply = async () => {
    setBusy(true); setErr('')
    try {
      setMessages([])
      const st = await startChat({ model, ...settings })
      setStatus(st)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true); setErr('')
    try { setStatus(await stopChat()) } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending || !status?.ready) return
    setInput('')
    setErr('')
    const history: ChatMessage[] = [
      ...messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    setMessages([...messages, { role: 'user', content: text }, { role: 'assistant', content: '', pending: true }])
    setSending(true)
    setStats(null)
    genStart.current = performance.now()
    charsRef.current = 0
    stickRef.current = true
    try {
      const stream = await chatStream(history, settings.temperature)
      streamText(
        stream,
        (type, t) => {
          charsRef.current += t.length
          const el = (performance.now() - genStart.current) / 1000
          if (el > 0.4) setStats({ tps: (charsRef.current / 4) / el, tokens: null, live: true })
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (!last?.pending) return prev
            next[next.length - 1] = type === 'reason'
              ? { role: 'assistant', content: last.content, reason: (last.reason ?? '') + t, pending: true }
              : { role: 'assistant', content: last.content + t, reason: last.reason, pending: true }
            return next
          })
        },
        (st) => {
          if (st) setStats({ tps: st.tps, tokens: st.tokens, live: false })
          setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)))
        },
        (er) => { setErr(er.message); setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m))) },
      )
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er))
      setMessages((prev) => prev.filter((m) => !m.pending))
    } finally {
      setSending(false)
    }
  }

  const pickModel = (id: string) => {
    setModel(id)
    const m = ORNITH_MODELS.find((x) => x.id === id)
    setSettings((s) => ({ ...s, cpuMoe: m?.moe ? s.cpuMoe : 0 }))
  }

  return (
    <>
      <header className="chat-page-head">
        <div className="chat-head-titles">
          <p className="eyebrow">Sezione chat</p>
          <h1>Ornith, <em>in casa</em>.</h1>
        </div>
        <div className="chat-head-tools">
          <label className="chat-model">
            <span>modello</span>
            <select value={model} onChange={(e) => pickModel(e.target.value)}>
              {ORNITH_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.name} · {m.quant}</option>
              ))}
            </select>
          </label>
          <div className="chat-head-status">
            <span className={`chat-state ${status?.ready ? 'on' : ''}`}>
              <span className="led" aria-hidden />
              {status?.running
                ? (status.ready ? 'pronto' : 'in caricamento…')
                : 'spento'}
            </span>
            {status?.running ? (
              <button type="button" className="go ghost" onClick={stop} disabled={busy}>
                ferma
              </button>
            ) : (
              <button type="button" className="go" onClick={apply} disabled={busy}>
                {busy ? 'avvio…' : 'avvia'}
              </button>
            )}
          </div>
          <button
            type="button"
            className={`side-toggle ${settingsOpen ? 'on' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
          >
            impostazioni
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="chat-settings-panel">
          <div className="field-row">
            <div className="field">
              <label htmlFor="ctx">Contesto</label>
              <input id="ctx" type="number" min={1024} max={65536} step={1024}
                value={settings.context}
                onChange={(e) => setSettings({ ...settings, context: Number(e.target.value) || 8192 })} />
            </div>
            <div className="field">
              <label htmlFor="kv">KV cache</label>
              <select id="kv" value={settings.kv}
                onChange={(e) => setSettings({ ...settings, kv: e.target.value })}>
                {KV_OPTIONS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="temp">Temperatura</label>
              <input id="temp" type="number" min={0} max={2} step={0.1}
                value={settings.temperature}
                onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) || 0 })} />
            </div>
            <div className="field">
              <label htmlFor="ngl">Layer GPU</label>
              <input id="ngl" type="number" min={-1} max={200}
                value={settings.gpuLayers}
                onChange={(e) => setSettings({ ...settings, gpuLayers: Number(e.target.value) || 99 })} />
            </div>
            {selected?.moe && (
              <div className="field">
                <label htmlFor="cmoe">Layer MoE su CPU</label>
                <input id="cmoe" type="number" min={0} max={64}
                  value={settings.cpuMoe}
                  onChange={(e) => setSettings({ ...settings, cpuMoe: Math.max(0, Number(e.target.value) || 0) })}
                  title="Sposta i pesi degli esperti MoE dei primi N layer sulla CPU (libera VRAM)" />
              </div>
            )}
            <label className="field check">
              <input type="checkbox" checked={settings.mtp}
                onChange={(e) => setSettings({ ...settings, mtp: e.target.checked })} />
              <span>MTP (multi-token prediction)</span>
            </label>
          </div>
          {selected?.moe && settings.cpuMoe > 0 && (
            <p className="chat-note">I pesi degli esperti dei primi {settings.cpuMoe} layer andranno su CPU: meno VRAM, più lento.</p>
          )}
          <p className="hintline">{status?.running
            ? `modello attivo: ${status.model} · ctx ${status.params?.context} · KV ${status.params?.kv}${status.params?.cpuMoe ? ` · MoE cpu ${status.params.cpuMoe}` : ''}`
            : 'Configura e premi "avvia". Il cambio modello riavvia con i nuovi parametri.'}</p>
        </div>
      )}

      <section className="chat-scroll">
        <div className="chat-log" ref={logRef} onScroll={onLogScroll} aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty chat-empty">
              Nessuna conversazione.<br />Scrivi sotto e premi Invio per parlare con Ornith.
            </div>
          ) : (
            messages.map((m, i) => (
              m.role === 'user' ? (
                <div className="bubble user" key={i}>{m.content}</div>
              ) : (
                <div className="msg assistant" key={i}>
                  <span className="avatar" aria-hidden>O</span>
                  <div className="msg-body">
                    {m.reason && <ReasonBlock text={m.reason} streaming={!!m.pending} />}
                    <div className="msg-text">
                      <Markdown text={m.content} />
                      {m.pending && <span className="caret" aria-hidden />}
                    </div>
                  </div>
                </div>
              )
            ))
          )}
        </div>

        <section className="wiki">
          <h2 className="sec-title">Wiki · modelli chat</h2>
          <p className="sec-sub">
            I due Ornith di casa: famiglia, quantizzazione, dimensioni e come
            impostarli per non strozzare la VRAM (i numeri sono misurati su
            questa macchina).
          </p>
          {ORNITH_WIKI.map((m) => <WikiEntry key={m.id} model={m} />)}
        </section>
      </section>

      <div className="chat-composer">
        {stats && (
          <p className={`chat-stats ${stats.live ? 'live' : ''}`} role="status">
            {stats.live
              ? <>generazione… <strong>≈{stats.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</strong> tok/s</>
              : <><strong>{stats.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</strong> tok/s
                  {stats.tokens != null && <> · {stats.tokens} token</>}</>}
          </p>
        )}
        <form className="composer-box" onSubmit={send}>
          <textarea
            className="composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) }
            }}
            placeholder={status?.ready ? 'Chiedi qualcosa a Ornith… (Invio invia, Shift+Invio a capo)' : 'Server spento: premi "avvia" qui sopra.'}
            aria-label="Messaggio"
            rows={2}
            disabled={!status?.ready}
          />
          <button className="send-btn" type="submit"
            disabled={sending || !status?.ready || !input.trim()}
            title="Invia" aria-label="Invia">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 8l11-5-3.5 9-2.2-3.6L2 8z" fill="currentColor" />
            </svg>
          </button>
        </form>
        <p className={`hintline ${err ? 'err' : ''}`} role="status">{err}</p>
      </div>
    </>
  )
}