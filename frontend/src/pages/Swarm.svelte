<script lang="ts">
  import { onMount } from 'svelte'
  import { getChatStatus, startChat } from '../api/chat'
  import type { ChatStatus } from '../api/chat'
  import { Swarm } from '../lib/swarm'

  // Stormo: 4 stadi sullo stesso MiniCPM5-2B Q4_K_M (1.5 GB, ~179 t/s).
  //   1 PIANO     — scompone l'obiettivo in sotto-task (1 call, repair x2)
  //   2 ESECUZIONE — un worker per sotto-task, in parallelo (mapLimit)
  //   3 CRITICO   — segnala i risultati che rispondono davvero
  //   4 SINTESI   — un piano ordinato per fasi
  // Nessun modello di sintesi dedicato: il merge è dentro il 2B perché qui
  // il compito è meccanico, non ragionato.

  interface Stage {
    key: string
    label: string
    ms: number
    tokens: number
    attempts: number
    ok: boolean
    error: string
    detail: string
  }

  const EXAMPLE = 'Vorrei aprire una libreria di quartiere a November. Ho 15.000 euro, un locale di 60 m2 in zona semicentrale e nessuna esperienza gestionale.'

  let status = $state<ChatStatus | null>(null)
  let mockMode = $state(false)
  let statusErr = $state('')
  let goal = $state(EXAMPLE)
  let running = $state(false)
  let stages = $state<Stage[]>([])
  let plan = $state<Swarm.Plan | null>(null)
  let results = $state<Swarm.WorkResult[]>([])
  let kept = $state<Swarm.WorkResult[]>([])
  let synthesis = $state<Swarm.Synthesis | null>(null)
  let workers = $state(3)
  let totalMs = $state(0)

  let live = $derived(stages.length > 0 && running)

  async function refresh() {
    try {
      status = await getChatStatus()
      statusErr = ''
      mockMode = !(status?.running && status?.ready && status?.model === 'minicpm5-2b')
    } catch (e) {
      statusErr = e instanceof Error ? e.message : String(e)
      mockMode = true
    }
  }

  onMount(refresh)

  async function ensureMiniCPM() {
    await startChat({
      model: 'minicpm5-2b', context: 8192, kv: 'q8_0', mtp: false,
      cpuMoe: 0, movaCpu: false, gpuLayers: 99, thinking: false,
    })
    await refresh()
  }

  // Una call atomica al modello: niente streaming (solo 60-300 token di
  // JSON). temp 0 = il 2B smette di improvvare la forma.
  async function call(system: string, user: string, maxTokens: number): Promise<string> {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        temperature: 0,
        max_tokens: maxTokens,
      }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    return j?.choices?.[0]?.message?.content ?? ''
  }

  function pushStage(s: Stage) {
    stages = [...stages.filter((x) => x.key !== s.key), s]
  }

  // ── 1. PIANO (con repair, il punto in cui un 2B sbaglia di più) ──
  async function stagePlan(goalText: string): Promise<Swarm.Plan | null> {
    const t0 = performance.now()
    let attempts = 0
    let problems: string[] = ['(primo colpo)']
    for (let i = 0; i < 2; i++) {
      attempts++
      const user = i === 0 ? goalText : `${goalText}\n\n${Swarm.repairPrompt(problems)}`
      const raw = await call(Swarm.PLAN_SYSTEM, user, 400)
      const { value, error } = Swarm.extractJson<Swarm.Plan>(raw)
      problems = Swarm.validatePlan(value)
      if (problems.length === 0) {
        pushStage({
          key: 'piano', label: '1 · Piano', ms: Math.round(performance.now() - t0),
          tokens: raw.length, attempts, ok: true, error: '',
          detail: value!.subtasks.map((s) => s.id).join(' · '),
        })
        return value
      }
      pushStage({
        key: 'piano', label: '1 · Piano', ms: Math.round(performance.now() - t0),
        tokens: raw.length, attempts, ok: false, error: problems.join('; '),
        detail: error ? 'JSON non parsabile' : 'piano rifiutato → repair',
      })
    }
    return null
  }

  // ── 2. ESECUZIONE (un worker per sotto-task) ──
  async function stageWorkers(p: Swarm.Plan, goalText: string, n: number): Promise<Swarm.WorkResult[]> {
    const t0 = performance.now()
    const out = await Swarm.mapLimit(p.subtasks, n, async (s) => {
      const raw = await call(
        Swarm.WORKER_SYSTEM,
        `Obiettivo: ${goalText}\n\nSotto-task "${s.id}": ${s.task}`,
        300,
      )
      const { value } = Swarm.extractJson<Swarm.WorkResult>(raw)
      return { id: s.id, done: value?.done?.trim() || raw.slice(0, 200) }
    })
    pushStage({
      key: 'esecuzione', label: '2 · Esecuzione', ms: Math.round(performance.now() - t0),
      tokens: out.length * 160, attempts: 1,
      ok: out.every((r) => r.done.length > 0), error: '',
      detail: `${out.length} worker in parallelo (max ${n} in volo)`,
    })
    return out
  }

  // ── 3. CRITICO ──
  async function stageCritic(p: Swarm.Plan, res: Swarm.WorkResult[]): Promise<Swarm.Verdict> {
    const t0 = performance.now()
    const listing = res
      .map((r, i) => `${i + 1}. [${p.subtasks[i]?.id}] ${r.done.slice(0, 160)}`)
      .join('\n')
    const raw = await call(
      Swarm.CRITIC_SYSTEM,
      `Sotto-task:\n${p.subtasks.map((s) => `- ${s.id}: ${s.task}`).join('\n')}\n\nRisultati:\n${listing}`,
      120,
    )
    const { value } = Swarm.extractJson<Swarm.Verdict>(raw)
    const valid = (value?.valid ?? []).filter((i) => i >= 1 && i <= res.length)
    pushStage({
      key: 'critico', label: '3 · Critico', ms: Math.round(performance.now() - t0),
      tokens: raw.length, attempts: 1, ok: valid.length > 0, error: '',
      detail: valid.length ? `validi: ${valid.join(', ')}` : 'nessun valido → tengo tutto',
    })
    return { valid, note: value?.note ?? '' }
  }

  // ── 4. SINTESI ──
  async function stageSynthesis(keptResults: Swarm.WorkResult[]): Promise<Swarm.Synthesis | null> {
    const t0 = performance.now()
    const raw = await call(
      Swarm.SYNTH_SYSTEM,
      keptResults.map((r) => `- [${r.id}] ${r.done}`).join('\n'),
      400,
    )
    const { value } = Swarm.extractJson<Swarm.Synthesis>(raw)
    const planOut = Array.isArray(value?.plan) ? value.plan.filter((s) => typeof s === 'string') : []
    pushStage({
      key: 'sintesi', label: '4 · Sintesi', ms: Math.round(performance.now() - t0),
      tokens: raw.length, attempts: 1, ok: planOut.length > 0,
      error: planOut.length ? '' : 'sintesi non parsabile',
      detail: `${planOut.length} fasi`,
    })
    return planOut.length ? { plan: planOut } : null
  }

  async function run(mock: boolean) {
    if (running || !goal.trim()) return
    running = true
    stages = []; plan = null; results = []; kept = []; synthesis = null
    const t0 = performance.now()
    try {
      if (mock) {
        plan = { subtasks: [
          { id: 'business_plan', task: 'business plan e numeri' },
          { id: 'local_search', task: 'ricerca del locale' },
          { id: 'legal_setup', task: 'apertura e licenze' },
          { id: 'stock_plan', task: 'assortimento e inventario' },
        ] }
        pushStage({ key: 'piano', label: '1 · Piano', ms: 340, tokens: 260, attempts: 2, ok: true, error: '', detail: plan.subtasks.map((s) => s.id).join(' · ') })
        results = [
          { id: 'business_plan', done: 'Ricavi stimati 42.000 €/anno con soglia di pareggio a 18 mesi; budget iniziale 15.000 € copre allestimento 7.000, stock 5.000, licenze 1.500, riserve 1.500.' },
          { id: 'local_search', done: 'Contratto in locazione con canone 850 €/mese, durata 6 anni + 6, caparra 3 mesi, apertura su via secondaria con 900 passaggi/giorno.' },
          { id: 'legal_setup', done: 'SRL con socio unico: capitale 1 €, spese notarili ~600 €, SCIA apertura entro 15 giorni, autorizzazione dehors stagionale.' },
          { id: 'stock_plan', done: 'Assortimento iniziale 900 titoli (60% narrativa, 25% saggistica, 15% fumetti); 4 rotazioni/anno, margine medio 32%.' },
        ]
        await new Promise((r) => setTimeout(r, 620))
        pushStage({ key: 'esecuzione', label: '2 · Esecuzione', ms: 620, tokens: 640, attempts: 1, ok: true, error: '', detail: '4 worker in parallelo (max 3 in volo)' })
        await new Promise((r) => setTimeout(r, 280))
        pushStage({ key: 'critico', label: '3 · Critico', ms: 280, tokens: 90, attempts: 1, ok: true, error: '', detail: 'validi: 1, 2, 3, 4' })
        kept = Swarm.verified(results, [1, 2, 3, 4])
        await new Promise((r) => setTimeout(r, 410))
        synthesis = { plan: [
          'Novembre: business plan numerico, contratto del locale e apertura SRL.',
          'Settembre: scelta dei 900 titoli, ordine ai fornitori, allestimento del punto vendita.',
          'Ottobre: SCIA, licenze, personale, sistema POS e prova di apertura al pubblico.',
          'Novembre: apertura, prima rotazione di 150 titoli, raccolta dei feedback.',
          'Marzo: primo bilancio di 4 mesi, taglio dei titoli a rotazione zero, prima campagna eventi.',
        ] }
        pushStage({ key: 'sintesi', label: '4 · Sintesi', ms: 410, tokens: 300, attempts: 1, ok: true, error: '', detail: '5 fasi' })
      } else {
        plan = await stagePlan(goal.trim())
        if (plan) {
          results = await stageWorkers(plan, goal.trim(), workers)
          const v = await stageCritic(plan, results)
          kept = v.valid.length ? Swarm.verified(results, v.valid) : results
          synthesis = await stageSynthesis(kept)
        }
      }
    } catch (e) {
      pushStage({
        key: 'errore', label: 'Errore', ms: 0, tokens: 0, attempts: 0,
        ok: false, error: e instanceof Error ? e.message : String(e), detail: '',
      })
    }
    totalMs = Math.round(performance.now() - t0)
    running = false
  }
</script>

<section class="swarm" aria-label="Stormo di agenti MiniCPM">
  <p class="eyebrow">Stormo · pipeline a 4 stadi</p>
  <h1>MiniCPM5 2B <em>Q4_K_M</em> al lavoro</h1>
  <p class="lede">
    Quattro stadi, un solo modello da 1,5 GB: scompone, esegui in parallelo,
    verifica, sintetizza. Ogni chiamata è atomica (60–400 token, temp 0) perché
    il 2B è bravo a fare un pezzo, non a pensare.
  </p>

  <div class="bar">
    <span class="pill">
      {status ? (status.running ? `🟢 ${status.model ?? '?'} ${status.ready ? 'ready' : 'loading…'}` : '⚪ chat spenta') : '…'}
    </span>
    {#if mockMode}<span class="pill warn">mock-mode — gira simulato</span>{/if}
    <button type="button" onclick={refresh} disabled={running}>ricontrolla</button>
    <button type="button" onclick={ensureMiniCPM} disabled={running}>avvia MiniCPM</button>
    {#if statusErr}<span class="err">{statusErr}</span>{/if}
  </div>

  <label class="fld">
    <span>Obiettivo da scomporre</span>
    <textarea rows="3" bind:value={goal} disabled={running || live}></textarea>
  </label>

  <div class="row">
    <label class="conc">
      worker in volo
      <input type="number" min="1" max="6" bind:value={workers} disabled={running || live} />
    </label>
    <button type="button" class="go" onclick={() => run(false)} disabled={running || live || mockMode}>
      {running ? 'stormo in volo…' : 'lancia stormo reale'}
    </button>
    <button type="button" onclick={() => run(true)} disabled={running || live}>
      {running ? '…' : 'prova mock (senza GPU)'}
    </button>
  </div>

  {#if stages.length > 0}
    <ol class="stages" aria-label="Stadi eseguiti">
      {#each stages as s (s.key)}
        <li class:bad={!s.ok}>
          <span class="s-label">{s.label}</span>
          <span class="s-detail">{s.detail || s.error}</span>
          <span class="s-time">{s.ms} ms{s.attempts > 1 ? ` · ${s.attempts} tentativi` : ''}</span>
        </li>
      {/each}
    </ol>
    <p class="meta">wall-time: <strong>{totalMs} ms</strong></p>
  {/if}

  {#if plan}
    <h2>Sotto-task</h2>
    <div class="grid">
      {#each plan.subtasks as s (s.id)}
        <article class="card"><header><strong>{s.id}</strong></header><p>{s.task}</p></article>
      {/each}
    </div>
  {/if}

  {#if results.length > 0}
    <h2>Risultati worker {#if kept.length < results.length}<span class="rej">({results.length - kept.length} scartati dal critico)</span>{/if}</h2>
    <div class="grid">
      {#each results as r (r.id)}
        <article class="card" class:kept={kept.includes(r)}>
          <header><strong>{r.id}</strong><span>{kept.includes(r) ? '✓ tenuto' : '✗ scartato'}</span></header>
          <p>{r.done}</p>
        </article>
      {/each}
    </div>
  {/if}

  {#if synthesis}
    <h2>Piano finale</h2>
    <ol class="final">{#each synthesis.plan as f}<li>{f}</li>{/each}</ol>
  {/if}

  <details>
    <summary>Perché regge (e quando no)</summary>
    <ul>
      <li><strong>Q4_K_M</strong>: il piano in JSON è il punto in cui un 2B sbaglia; Q5/Q6 non lo salvano, Q3 lo rompono.</li>
      <li><strong>Repair mirato</strong>: il primo colpo torna quasi sempre storto, il secondo con <code>Correggi SOLO questi problemi</code> (<code>Swarm.validatePlan</code>) recupera quasi sempre.</li>
      <li><strong>Parallelismo reale</strong>: <code>mapLimit</code> con 2–3 worker in volo. Su una sola istanza l'hub serializza sulla GPU, quindi oltre 2–3 il tempo non scende: crescono solo i worker in coda.</li>
      <li><strong>Il critico è un filtro</strong>: se non valida niente tengo tutto — degradare è meglio che perdere.</li>
      <li><strong>Limite</strong>: sotto-task con giudizio di criterio (nomi, scelte di merito) vanno su Ornith/K2, non su un 2B.</li>
    </ul>
  </details>
</section>

<style>
  .swarm { max-width: 78ch; padding: 28px 8px 60px; }
  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); margin: 0 0 6px; }
  h1 { margin: 0 0 8px; } h1 em { color: var(--accent); font-style: normal; }
  h2 { font-family: var(--display); font-size: 17px; margin: 24px 0 8px; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 14px 0; }
  .pill { font-family: var(--mono); font-size: 11px; border: 1px solid var(--line); border-radius: 20px; padding: 3px 10px; }
  .pill.warn { border-color: var(--seal); color: var(--seal); }
  button { font-family: var(--mono); font-size: 12px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--ink-3); color: var(--paper); cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.go { border-color: var(--accent); }
  .err { color: var(--seal); font-size: 12px; }
  .fld { display: block; margin: 12px 0; } .fld span { font-size: 12px; color: var(--paper-dim); }
  textarea { width: 100%; margin-top: 6px; background: var(--ink-2); color: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 14px; }
  .row { display: flex; gap: 10px; align-items: center; margin: 10px 0 16px; flex-wrap: wrap; }
  .conc { display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; color: var(--paper-dim); }
  .conc input { width: 52px; background: var(--ink-2); color: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 5px; font-family: var(--mono); }
  .stages { list-style: none; padding: 0; margin: 0 0 6px; display: flex; flex-direction: column; gap: 6px; }
  .stages li { display: grid; grid-template-columns: 108px 1fr auto; gap: 10px; align-items: baseline; padding: 9px 12px; border: 1px solid var(--line); border-left: 3px solid var(--moss); border-radius: 8px; background: var(--ink-2); }
  .stages li.bad { border-left-color: var(--seal); }
  .s-label { font-family: var(--mono); font-size: 11px; color: var(--accent); }
  .s-detail { font-size: 12.5px; color: var(--paper-dim); }
  .s-time { font-family: var(--mono); font-size: 11px; color: var(--paper-faint); }
  .meta { font-size: 12px; color: var(--paper-dim); margin: 6px 0 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--ink-2); opacity: .5; }
  .card.kept { opacity: 1; border-color: var(--line); }
  .card header { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 5px; }
  .card header span { font-family: var(--mono); font-size: 10.5px; color: var(--paper-faint); }
  .card p { margin: 0; font-size: 13px; color: var(--paper-dim); }
  .rej { font-size: 12px; color: var(--seal); font-weight: 400; }
  .final { margin: 8px 0; padding-left: 20px; }
  .final li { margin-bottom: 6px; font-size: 14px; }
  details { margin-top: 22px; font-size: 13px; } summary { cursor: pointer; color: var(--accent); }
  details code { font-family: var(--mono); font-size: .85em; background: var(--ink-3); padding: 1px 5px; border-radius: 5px; }
</style>