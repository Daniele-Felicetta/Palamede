import { FormEvent, useEffect, useRef, useState } from 'react'
import { chatStream, ChatMessage, ChatStatus, getChatStatus, startChat, stopChat } from '../api'
import { ORNITH_MODELS, ORNITH_WIKI } from '../data/wiki'
import { WikiEntry } from '../components/WikiEntry'

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

function streamText(body: ReadableStream<Uint8Array>, onDelta: (type: 'reason' | 'content', t: string) => void, onDone: () => void, onErr: (e: Error) => void) {
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
          if (!d) continue
          // Ornith è un modello reasoning: prima i token di pensiero,
          // poi la risposta vera.
          if (typeof d.reasoning_content === 'string' && d.reasoning_content) onDelta('reason', d.reasoning_content)
          else if (typeof d.content === 'string' && d.content) onDelta('content', d.content)
        } catch { /* eventi non JSON ignorati */ }
      }
      pump()
    }).catch((e) => onErr(e instanceof Error ? e : new Error(String(e))))
  }
  pump()
}

interface Msg extends ChatMessage { pending?: boolean; reason?: string }

export function Chat() {
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [model, setModel] = useState('ornith-9b')
  const [settings, setSettings] = useState(DEFAULT)

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  const refresh = async () => {
    try { setStatus(await getChatStatus()) } catch { setStatus(null) }
  }
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

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
    try {
      const stream = await chatStream(history, settings.temperature)
      streamText(
        stream,
        (type, t) => setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (!last?.pending) return prev
          next[next.length - 1] = type === 'reason'
            ? { role: 'assistant', content: last.content, reason: (last.reason ?? '') + t, pending: true }
            : { role: 'assistant', content: last.content + t, reason: last.reason, pending: true }
          return next
        }),
        () => setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m))),
        (er) => { setErr(er.message); setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m))) },
      )
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er))
      setMessages((prev) => prev.filter((m) => !m.pending))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <p className="eyebrow">Sezione chat</p>
      <h1>Ornith, <em>in casa</em>.</h1>

      <section>
        <div className="chat-wrap">
          <form className="panel chat-panel" onSubmit={send}>
            {/* modello + impostazioni */}
            <div className="chat-toolbar">
              <div className="plates chat-plates">
                {ORNITH_MODELS.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className={`plate ${model === m.id ? 'sel' : ''}`}
                    onClick={() => { setModel(m.id); setSettings((s) => ({ ...s, cpuMoe: m.moe ? s.cpuMoe : 0 })) }}
                  >
                    <span className="pname">
                      <span className={`led ${status?.ready && status.model === m.id ? 'on' : 'off'}`} aria-hidden />
                      {m.name}
                    </span>
                    <span className="pstamps">
                      <span className="stamp">{m.family}</span>
                      <span className="stamp hot">{m.quant}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="chat-actions">
                {status?.running ? (
                  <button type="button" className="go ghost" onClick={stop} disabled={busy}>
                    ferma server
                  </button>
                ) : (
                  <button type="button" className="go" onClick={apply} disabled={busy}>
                    {busy ? 'avvio…' : 'avvia server'}
                  </button>
                )}
                <span className={`chat-state ${status?.ready ? 'on' : ''}`}>
                  <span className="led" aria-hidden />
                  {status?.running
                    ? (status.ready ? 'pronto' : 'in caricamento…')
                    : 'spento'}
                </span>
              </div>
            </div>

            <details className="chat-settings" open={!status?.running}>
              <summary>Impostazioni server</summary>
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
                : 'Configura e premi "avvia server". Il cambio modello riavvia con i nuovi parametri.'}</p>
            </details>

            {/* conversazione */}
            <div className="chat-log" aria-live="polite">
              {messages.length === 0 ? (
                <div className="empty chat-empty">
                  Nessuna conversazione.<br />Scrivi sotto e premi Invio per parlare con Ornith.
                </div>
              ) : (
                messages.map((m, i) => (
                  <div className={`bubble ${m.role}`} key={i}>
                    <span className="bubble-who">{m.role === 'user' ? 'tu' : 'Ornith'}</span>
                    <div className="bubble-text">
                      {m.reason && (
                        <div className="bubble-reason">
                          <span className="bubble-reason-label">ragionamento</span>
                          {m.reason}
                        </div>
                      )}
                      {m.content}
                      {m.pending && <span className="caret" aria-hidden />}
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            <div className="chat-input-row">
              <textarea
                className="prompt-box chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) }
                }}
                placeholder="Chiedi qualcosa a Ornith… (Invio invia, Shift+Invio a capo)"
                aria-label="Messaggio"
                rows={2}
              />
              <button className="go" type="submit" disabled={sending || !status?.ready || !input.trim()}>
                {sending ? '…' : 'Invia'}
              </button>
            </div>
            <p className={`hintline ${err ? 'err' : ''}`} role="status">{err}</p>
          </form>
        </div>
      </section>

      <section className="wiki">
        <h2 className="sec-title">Wiki · modelli chat</h2>
        <p className="sec-sub">
          I due Ornith di casa: famiglia, quantizzazione, dimensioni e come
          impostarli per non strozzare la VRAM (i numeri sono misurati su
          questa macchina).
        </p>
        {ORNITH_WIKI.map((m) => <WikiEntry key={m.id} model={m} />)}
      </section>
    </>
  )
}