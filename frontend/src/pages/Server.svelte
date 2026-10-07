<script lang="ts">
  // Zona "Server": cosa sta facendo il llama-server ADESSO, come fa LM
  // Studio. I numeri vengono da /api/server/metrics (hub/lib/server.mjs):
  // prefill e decode sono i timings che llama.cpp stampa sul log a ogni
  // richiesta conclusa, gli slot sono lo stato live di /slots.
  import { onMount } from 'svelte'
  import { getServerMetrics, getMetrics } from '../api'
  import type { ServerMetrics } from '../api/chat'
  import type { Metrics } from '../api/image'
  import { Eyebrow, Led, SectionHead, Stamp, ChatState, KvSquare } from '../components/ui'

  let m = $state<ServerMetrics | null>(null)
  let sys = $state<Metrics | null>(null)
  let err = $state('')
  let off = $state(false)
  // orologio locale per l'età "Xs fa": si aggiorna a ogni poll
  let nowTs = $state(Date.now())

  const STALE_MS = 15000

  // nomi leggibili dal path del modello
  let modelLabel = $derived.by(() => {
    const p = m?.props?.modelPath
    if (!p) return '—'
    const file = p.split(/[\\/]/).pop() ?? p
    return file.replace(/\.gguf$/i, '')
  })

  function fmt(n: number | null | undefined, digits = 0): string {
    if (n == null || !Number.isFinite(n)) return '—'
    return n.toLocaleString('it-IT', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
  }

  function pct(used: number, total: number): number {
    return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  }

  /** "adesso" / "Xs fa" / "Xm fa" da un epoch-ms */
  function age(at: number | null | undefined): string {
    if (!at) return 'mai'
    const s = Math.max(0, Math.round((nowTs - at) / 1000))
    if (s < 2) return 'adesso'
    if (s < 60) return `${s}s fa`
    return `${Math.floor(s / 60)}m ${s % 60}s fa`
  }

  function isStale(at: number | null | undefined, ms = STALE_MS): boolean {
    if (!at) return true
    return nowTs - at > ms
  }

  let prefillStale = $derived(isStale(m?.prefill?.at))
  let decodeStale = $derived(isStale(m?.decode?.at))

  async function tick() {
    try {
      const [a, b] = await Promise.all([getServerMetrics(), getMetrics()])
      m = a
      sys = b
      nowTs = Date.now()
      err = ''
      off = false
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
      off = true
    }
  }

  onMount(() => {
    tick()
    // 1.5s: abbastanza fresco da vedere il prefill che avanza, e l'hub
    // risponde in pochi ms (cache 1.2s + /slots locale).
    const t = setInterval(tick, 1500)
    return () => clearInterval(t)
  })
</script>

<section class="srv" aria-label="Telemetria del server">
  <Eyebrow>Server · telemetria del llama-server</Eyebrow>
  <h1>Server</h1>
  <p class="lede">
    Cosa sta succedendo sotto, in tempo reale: quanti token al secondo nel
    prompt (prefill) e nella risposta (decode), quanti slot sono al lavoro e
    quanto costa in VRAM.
  </p>
  {#if m?.at}
    <p class="srv-age" role="status">dati di {age(m.at)} · prefill {age(m.prefill?.at)} · decode {age(m.decode?.at)}</p>
  {/if}

  {#if off}
    <p class="srv-off" role="status">
      <ChatState state="off">hub non raggiungibile</ChatState>
      <span>{err}</span>
    </p>
  {:else if m && !m.running}
    <p class="srv-off" role="status">
      <ChatState state="off">server testo spento</ChatState>
      <span>
        Nessun llama-server su <code>:{m.port}</code>. Avvialo dalla pagina
        <a href="#/chat">Chat</a> scegliendo un modello.
      </span>
    </p>
  {/if}

  {#if m?.running}
    {#if !m.managed}
      <p class="srv-warn">
        <Stamp hot>non tracciato</Stamp>
        gira sulla porta <code>:{m.port}</code> ma non è stato avviato da questo hub
        (avviato a mano, o da un'altra istanza).
      </p>
    {/if}

    <!-- numeri grandi: prefill e decode, la coppia che spiega la velocita' -->
    <div class="bignums">
      <article class="big" class:live={!!m.live} class:stale={prefillStale && !m.live}>
        <span class="big-num">{fmt(m.prefill?.tps, 0)}</span>
        <span class="big-unit">tok/s</span>
        <span class="big-lab">prefill {#if m.live}(live){:else if prefillStale}(ultimo){/if}</span>
        <span class="big-sub">
          {#if m.prefill}
            {fmt(m.prefill.tokens)} token in {fmt(m.prefill.ms)} ms · {fmt(m.prefill.msPerToken, 2)} ms/token · {age(m.prefill.at)}{#if m.prefill.slot != null} · slot {m.prefill.slot}{/if}
          {:else}in attesa{/if}
        </span>
      </article>
      <article class="big" class:live={!!m.liveDecode} class:stale={decodeStale && !m.liveDecode}>
        <span class="big-num">{fmt(m.liveDecode?.tps ?? m.decode?.tps, 1)}</span>
        <span class="big-unit">tok/s</span>
        <span class="big-lab">decode {#if m.liveDecode}(live){:else if decodeStale && m.decode}(ultimo){/if}</span>
        <span class="big-sub">
          {#if m.liveDecode}
            {fmt(m.liveDecode.tokens)} token · istantaneo su 3 s · media {fmt(m.liveDecode.avgTps, 1)}
          {:else if m.decode}
            {fmt(m.decode.tokens)} token · {fmt(m.decode.msPerToken, 2)} ms/token · {age(m.decode.at)}
          {:else}in attesa{/if}
        </span>
      </article>
      <article class="big">
        <span class="big-num">{fmt(m.props?.nCtx, 0)}</span>
        <span class="big-unit">ctx</span>
        <span class="big-lab">contesto per slot</span>
        <span class="big-sub">{fmt(m.slots.length)} slot · {fmt(m.props?.totalSlots)} totali</span>
      </article>
      <article class="big">
        <span class="big-num">{fmt(sys?.gpu?.vramUsedGB, 1)}</span>
        <span class="big-unit">GB</span>
        <span class="big-lab">VRAM in uso</span>
        <span class="big-sub">
          {#if sys?.gpu?.vramTotalGB}
            {pct(sys.gpu.vramUsedGB, sys.gpu.vramTotalGB)}% di {fmt(sys.gpu.vramTotalGB, 1)} GB
          {:else}—{/if}
        </span>
      </article>
    </div>

    {#if m.live}
      <div class="prog" role="status">
        <span class="prog-lab">prefill in corso · {Math.round(m.live.fraction * 100)}%</span>
        <div class="prog-bar"><span style={`width:${Math.round(m.live.fraction * 100)}%`}></span></div>
        <span class="prog-num">
          {fmt(m.live.done)} token · {fmt(m.live.tps, 0)} tok/s · {fmt(m.live.seconds, 0)} s{#if m.live.etaSec > 1} · resta ~{fmt(m.live.etaSec, 0)} s{/if}
        </span>
      </div>
    {/if}

    {#if m.busySlot}
      <div class="busy">
        <Stamp ok>slot {m.busySlot.id} al lavoro</Stamp>
        <span>
          task {m.busySlot.task} · prompt {fmt(m.busySlot.promptTokens)} token
          (elaborati {fmt(m.busySlot.processed)})
          {#if m.busySlot.cached}· {fmt(m.busySlot.cached)} dalla cache{/if}
          {#if m.busySlot.temperature != null}· temp {fmt(m.busySlot.temperature, 2)}{/if}
        </span>
      </div>
    {:else}
      <p class="idle" role="status"><ChatState state="on">nessuno slot al lavoro</ChatState> il server e' in attesa</p>
    {/if}

    <SectionHead
      title="Slot"
      sub="llama-server tiene piu' corsie in parallelo e assegna ogni richiesta alla piu' libera. Palamede non forza il numero: conta quello che il server ha scelto."
    />
    <div class="slots">
      {#each m.slots as s (s.id)}
        <article class="slot" class:on={s.processing}>
          <header>
            <strong>slot {s.id}</strong>
            <Led state={s.processing ? 'busy' : 'off'} title={s.processing ? 'al lavoro' : 'libero'} />
          </header>
          <dl>
            <div><dt>ctx</dt><dd>{fmt(s.nCtx)}</dd></div>
            <div><dt>prompt</dt><dd>{fmt(s.promptTokens)}</dd></div>
            <div><dt>elaborati</dt><dd>{fmt(s.processed)}</dd></div>
            <div><dt>cache</dt><dd>{fmt(s.cached)}</dd></div>
            {#if s.temperature != null}<div><dt>temp</dt><dd>{fmt(s.temperature, 2)}</dd></div>{/if}
            {#if s.maxTokens != null}<div><dt>max</dt><dd>{fmt(s.maxTokens)}</dd></div>{/if}
          </dl>
        </article>
      {/each}
    </div>

    <SectionHead title="Modello caricato" sub="Cosa sta servendo il server sulla porta." />
    <dl class="spec">
      <div><dt>modello</dt><dd>{modelLabel}</dd></div>
      {#if m.props?.ftype}<div><dt>quantizzazione</dt><dd>{m.props.ftype}</dd></div>{/if}
      <div><dt>build llama.cpp</dt><dd>{m.props?.buildInfo ?? '—'}</dd></div>
      <div><dt>porta</dt><dd>:{m.port}</dd></div>
      {#if m.pid}<div><dt>pid</dt><dd>{m.pid}</dd></div>{/if}
      <div><dt>contesto avviato</dt><dd>{fmt(m.params?.context ?? m.props?.nCtx)}</dd></div>
      <div><dt>layer GPU</dt><dd>{m.params ? m.params.gpuLayers : '— (non tracciato)'}</dd></div>
      {#if m.params?.cpuMoe}<div><dt>MoE su CPU</dt><dd>{m.params.cpuMoe} layer</dd></div>{/if}
      <div><dt>thinking</dt><dd>{m.params ? (m.params.thinking ? 'on' : 'off') : '— (non tracciato)'}</dd></div>
    </dl>

    {#if m.params}
      <div class="kv-tile">
        <KvSquare value={m.params.kv} context={m.props?.nCtx} />
      </div>
    {/if}

    <details>
      <summary>Come si leggono prefill e decode</summary>
      <ul>
        <li><strong>prefill</strong> = token al secondo con cui il modello LEGGE il tuo prompt. È il numero che crolla quando il contesto è enorme: con 200k di contesto la KV cache satura la VRAM e si va a 30-50 tok/s.</li>
        <li><strong>decode</strong> = token al secondo con cui SCRIVE la risposta. Su K2 36B-A4B in Q4 con esperti su CPU si aggira sui 60-70 tok/s; con un modello piccolo (MiniCPM 2B) si superano i 150.</li>
        <li>Se il prefill è basso ma il decode è normale, non è il modello: è il contesto che non entra in VRAM.</li>
      </ul>
    </details>
  {/if}
</section>

<style>
  .srv { max-width: 84ch; padding: 28px 8px 60px; }
  .srv-off, .idle, .busy, .srv-warn {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    font-size: 13px; color: var(--paper-dim);
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 12px 14px; margin: 14px 0;
  }
  .srv-warn { border-color: var(--amber); }
  .srv-off code, .srv-warn code { font-family: var(--mono); font-size: .85em; }

  .bignums { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 12px; margin: 16px 0; }
  .big {
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--ink-2); padding: 14px 16px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .big.live { border-color: var(--accent); }
  .big.stale .big-num { opacity: .45; }
  .srv-age { font-family: var(--mono); font-size: 11px; color: var(--paper-faint); margin: 6px 0 0; }
  .big-num { font-family: var(--display); font-size: 34px; font-weight: 600; line-height: 1; color: var(--paper); }
  .big.live .big-num { color: var(--accent); }
  .big-unit { font-family: var(--mono); font-size: 11px; color: var(--paper-faint); }
  .big-lab { font-family: var(--mono); font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--paper-dim); margin-top: 6px; }
  .big-sub { font-family: var(--mono); font-size: 10.5px; color: var(--paper-faint); margin-top: 2px; }

  .prog { display: flex; align-items: center; gap: 12px; margin: 8px 0 14px; font-size: 12px; }
  .prog-lab { font-family: var(--mono); font-size: 11px; color: var(--accent); letter-spacing: .8px; }
  .prog-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--ink-3); overflow: hidden; }
  .prog-bar span { display: block; height: 100%; background: var(--accent); transition: width .4s linear; }
  .prog-num { font-family: var(--mono); font-size: 11px; color: var(--paper-faint); }

  .slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
  .slot { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 11px 13px; background: var(--ink-2); }
  .slot.on { border-color: var(--accent); }
  .slot header { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; margin-bottom: 7px; }
  .slot dl, .spec { margin: 0; }
  .slot dl > div, .spec > div { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .slot dt, .spec dt { font-family: var(--mono); font-size: 10.5px; color: var(--paper-faint); }
  .slot dd, .spec dd { margin: 0; font-family: var(--mono); font-size: 11.5px; color: var(--paper); text-align: right; word-break: break-all; }

  .spec { margin-top: 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; background: var(--ink-2); }
  .spec > div + div { border-top: 1px solid var(--line); margin-top: 3px; padding-top: 5px; }
  .kv-tile { margin-top: 12px; }

  details { margin-top: 22px; font-size: 13px; }
  summary { cursor: pointer; color: var(--accent); }
  details li { margin-bottom: 6px; }
  details strong { color: var(--paper); }
</style>