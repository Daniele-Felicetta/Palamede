<script lang="ts">
  import { onMount } from 'svelte'
  import { getBench, getImageBench, benchImageUrl } from '../api'
  import type { BenchSummary, ImageBenchSummary } from '../api'
  import { Text } from '../lib/text'
  import { navigate } from '../router.svelte'
  import { EmptyState, Gauge, Hintline, SectionHead, Stamp } from '../components/ui'

  // `embed` = montata dentro la pagina Extra: niente testata propria.
  let { embed = false }: { embed?: boolean } = $props()

  let data = $state<BenchSummary | null>(null)
  let img = $state<ImageBenchSummary | null>(null)
  let err = $state('')
  let loading = $state(true)

  onMount(async () => {
    try {
      const [t, i] = await Promise.all([getBench(), getImageBench()])
      data = t
      img = i
    } catch (e) { err = e instanceof Error ? e.message : String(e) }
    finally { loading = false }
  })

  const name = (id: string) => Text.modelName(id)
  const fmt = (x: number | null | undefined, d = 1) => (x == null ? '—' : Number(x).toFixed(d))
  const sec = (ms: number | null | undefined) => (ms == null ? '—' : (ms / 1000).toFixed(1))
  const pct = (x: number | null | undefined) => (x == null ? '—' : (x * 100).toFixed(0) + '%')
  const catPct = (x: number | null | undefined) => (x == null ? '—' : (x * 100).toFixed(0))

  // ── testuali ──
  let rows = $derived(data ? [...data.rows].sort((a, b) => (b.combined ?? -1) - (a.combined ?? -1)) : [])
  let cats = $derived(data?.categories ?? [])
  let bestQ = $derived(data ? Math.max(...data.rows.map((r) => r.q ?? -1)) : -1)
  let bestTg = $derived(data ? Math.max(...data.rows.map((r) => r.tg ?? -1)) : -1)
  let bestC = $derived(data ? Math.max(...data.rows.map((r) => r.combined ?? -1)) : -1)
  let topQ = $derived(data?.rows.find((r) => r.q === bestQ))
  let topTg = $derived(data?.rows.find((r) => r.tg === bestTg))
  let topC = $derived(data?.rows.find((r) => r.combined === bestC))
  let moeCfg = $derived(data ? data.rows.filter((r) => r.qualityConfig && (r.qualityConfig.cpuMoe || (r.qualityConfig.ncmoe ?? 0) > 0)) : [])

  // ── immagini ──
  let irows = $derived(img ? [...img.rows].sort((a, b) => (b.combined ?? -1) - (a.combined ?? -1)) : [])
  let iBestQ = $derived(img ? Math.max(...img.rows.map((r) => r.q ?? -1)) : -1)
  let iBestSps = $derived(img ? Math.max(...img.rows.map((r) => r.sps512 ?? -1)) : -1)
  let iBestC = $derived(img ? Math.max(...img.rows.map((r) => r.combined ?? -1)) : -1)
  let iTopQ = $derived(img?.rows.find((r) => r.q === iBestQ))
  let iTopSps = $derived(img?.rows.find((r) => r.sps512 === iBestSps))
  let iTopC = $derived(img?.rows.find((r) => r.combined === iBestC))
  let iname = (id: string) => img?.rows.find((r) => r.id === id)?.name ?? id
</script>

{#if !embed}
  <SectionHead
    title="Banco di prova"
    sub="Misure reali su questa macchina, modello per modello. Un solo modello in VRAM alla volta. Velocità e qualità dei modelli testuali (llama.cpp) e dei generatori di immagini (sd.cpp / gemlite)."
  />
{/if}

{#if loading}
  <Hintline>lettura del registro…</Hintline>
{:else if err}
  <Hintline err>{err}</Hintline>
{:else if !data && !img}
  <EmptyState>
    <p class="empty-title">Nessun benchmark registrato</p>
    <p>Esegui <code>node scripts/bench-text.mjs</code> e <code>node scripts/bench-images.mjs</code> dalla root del progetto: al termine i risultati compaiono qui.</p>
  </EmptyState>
{:else}
  {#if data}
    <section class="bench-part" aria-label="Modelli testuali">
      <h2 class="bench-part-title">Modelli testuali</h2>
      <Gauge
        cells={[
          { num: String(data.rows.length), label: 'modelli sul banco' },
          { num: topQ ? pct(topQ.q).replace('%', '') : '—', unit: '%', label: 'miglior qualità · ' + (topQ ? name(topQ.id) : '') },
          { num: topTg ? fmt(topTg.tg, 0) : '—', unit: 't/s', label: 'più veloce · ' + (topTg ? name(topTg.id) : '') },
          { num: topC ? fmt(topC.combined, 0) : '—', label: 'miglior compromesso · ' + (topC ? name(topC.id) : '') },
        ]}
      />

      <section class="bench-block" aria-label="Risultati per modello">
        <h3 class="bench-h">Tutti i modelli</h3>
        <div class="bench-scroll">
          <table class="bench-table">
            <thead>
              <tr>
                <th>Modello</th>
                <th class="num">Qualità</th>
                <th class="num">pp512 t/s</th>
                <th class="num">tg128 t/s</th>
                <th class="num">Load s</th>
                <th class="num">Combined</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as r (r.id)}
                <tr>
                  <td class="bench-model">
                    {r.name}
                    {#if r.qualityConfig?.cpuMoe || (r.qualityConfig?.ncmoe ?? 0) > 0}
                      <Stamp title="esperti MoE spostati su CPU per stare in 16 GB di VRAM">MoE su CPU</Stamp>
                    {/if}
                  </td>
                  <td class="num {r.q === bestQ ? 'best' : ''}">{pct(r.q)}</td>
                  <td class="num">{fmt(r.pp, 0)}</td>
                  <td class="num {r.tg === bestTg ? 'best' : ''}">{fmt(r.tg)}</td>
                  <td class="num">{r.loadMs != null ? (r.loadMs / 1000).toFixed(1) : '—'}</td>
                  <td class="num {r.combined === bestC ? 'best' : ''}">{fmt(r.combined, 0)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if moeCfg.length}
          <p class="bench-note">
            I modelli grandi ({moeCfg.map((r) => name(r.id)).join(', ')}) girano con parte degli esperti MoE sulla CPU:
            il tg128 misura la configurazione che entra in 16 GB di VRAM. Gli altri sono interamente su GPU.
          </p>
        {/if}
      </section>

      <section class="rank-grid" aria-label="Classifiche testuali">
        <div class="rank-card">
          <h3 class="bench-h">Per qualità</h3>
          <ol class="rank-list">
            {#each data.byQuality as r (r.id)}
              <li><span class="rank-pos">{r.pos}</span><span class="rank-name">{name(r.id)}</span><span class="rank-val">{pct(r.val)}</span></li>
            {/each}
          </ol>
        </div>
        <div class="rank-card">
          <h3 class="bench-h">Per velocità (tg128)</h3>
          <ol class="rank-list">
            {#each data.bySpeed as r (r.id)}
              <li><span class="rank-pos">{r.pos}</span><span class="rank-name">{name(r.id)}</span><span class="rank-val">{fmt(r.val)} t/s</span></li>
            {/each}
          </ol>
        </div>
        <div class="rank-card">
          <h3 class="bench-h">Combinata</h3>
          <ol class="rank-list">
            {#each data.byCombined as r (r.id)}
              <li><span class="rank-pos">{r.pos}</span><span class="rank-name">{name(r.id)}</span><span class="rank-val">{fmt(r.val, 0)}</span></li>
            {/each}
          </ol>
          <p class="rank-foot">50% qualità + 50% velocità normalizzata sul modello più veloce.</p>
        </div>
      </section>

      {#if cats.length}
        <section class="bench-block" aria-label="Qualità per categoria">
          <h3 class="bench-h">Qualità per categoria <span class="bench-sub">(% di risposte corrette)</span></h3>
          <div class="bench-scroll">
            <table class="bench-table cat">
              <thead>
                <tr>
                  <th>Modello</th>
                  {#each cats as c (c)}<th class="num">{c}</th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each rows as r (r.id)}
                  <tr>
                    <td class="bench-model">{r.name}</td>
                    {#each cats as c (c)}<td class="num">{catPct(r.byCategory?.[c])}</td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      <section class="bench-block" aria-label="Metodo testuali">
        <h3 class="bench-h">Metodo e dati</h3>
        <ul class="bench-method">
          <li><strong>Velocità</strong> — {data.method?.speed ?? 'llama-bench pp512/tg128'}.</li>
          <li><strong>Qualità</strong> — {data.method?.quality ?? `${data.evalCount ?? 30} item a punteggio oggettivo`}.</li>
          <li><strong>Hardware</strong> — {data.hardware} · misurato il {new Date(data.generatedAt).toLocaleString('it-IT')}.</li>
        </ul>
        <p class="bench-note">
          Dati grezzi in <code>outputs/benchmark/</code> · rigenera con <code>node scripts/bench-text.mjs</code>.
          Prova i modelli in <a href="#/chat" onclick={(e) => { e.preventDefault(); navigate('/chat') }}>Chat</a> ·
          <a href="#/downloader">scarica modelli</a>.
        </p>
      </section>
    </section>
  {/if}

  {#if img}
    <section class="bench-part" aria-label="Modelli immagine">
      <h2 class="bench-part-title">Modelli immagine</h2>
      <Gauge
        cells={[
          { num: String(img.rows.length), label: 'generatori sul banco' },
          { num: iTopQ ? fmt(iTopQ.q, 1) : '—', unit: '/10', label: 'miglior qualità · ' + (iTopQ ? iTopQ.name : '') },
          { num: iTopSps ? fmt(iTopSps.sps512, 2) : '—', unit: 'img/s', label: 'più veloce a 512² · ' + (iTopSps ? iTopSps.name : '') },
          { num: iTopC ? fmt(iTopC.combined, 0) : '—', label: 'miglior compromesso · ' + (iTopC ? iTopC.name : '') },
        ]}
      />

      <section class="bench-block" aria-label="Risultati immagini per modello">
        <h3 class="bench-h">Tutti i generatori</h3>
        <div class="bench-scroll">
          <table class="bench-table">
            <thead>
              <tr>
                <th>Modello</th>
                <th class="num">Qualità /10</th>
                <th class="num">512² cold s</th>
                <th class="num">512² warm s</th>
                <th class="num">1024² warm s</th>
                <th class="num">img/s 512²</th>
                <th class="num">Combined</th>
              </tr>
            </thead>
            <tbody>
              {#each irows as r (r.id)}
                <tr>
                  <td class="bench-model">{r.name}<Stamp>{r.steps} step</Stamp></td>
                  <td class="num {r.q === iBestQ ? 'best' : ''}">{fmt(r.q, 2)}</td>
                  <td class="num">{sec(r.s512?.coldMs)}</td>
                  <td class="num {r.sps512 === iBestSps ? 'best' : ''}">{sec(r.s512?.warmMs)}</td>
                  <td class="num">{sec(r.s1024?.warmMs)}</td>
                  <td class="num">{fmt(r.sps512, 2)}</td>
                  <td class="num {r.combined === iBestC ? 'best' : ''}">{fmt(r.combined, 0)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="bench-note">
          Warm = immagine a regime (minimo di 2); cold = primo colpo a quella risoluzione (paga il JIT/autotune).
          A 1024² Qwen-Image è il più lento di un ordine di grandezza: è un modello CFG a 40 step.
        </p>
      </section>

      <section class="rank-grid" aria-label="Classifiche immagini">
        <div class="rank-card">
          <h3 class="bench-h">Per qualità</h3>
          <ol class="rank-list">
            {#each img.byQuality as r (r.id)}
              <li><span class="rank-pos">{r.pos}</span><span class="rank-name">{iname(r.id)}</span><span class="rank-val">{fmt(r.val, 2)}/10</span></li>
            {/each}
          </ol>
        </div>
        <div class="rank-card">
          <h3 class="bench-h">Per velocità (img/s a 512²)</h3>
          <ol class="rank-list">
            {#each img.bySpeed as r (r.id)}
              <li><span class="rank-pos">{r.pos}</span><span class="rank-name">{iname(r.id)}</span><span class="rank-val">{fmt(r.val, 3)}</span></li>
            {/each}
          </ol>
        </div>
        <div class="rank-card">
          <h3 class="bench-h">Combinata</h3>
          <ol class="rank-list">
            {#each img.byCombined as r (r.id)}
              <li><span class="rank-pos">{r.pos}</span><span class="rank-name">{iname(r.id)}</span><span class="rank-val">{fmt(r.val, 0)}</span></li>
            {/each}
          </ol>
          <p class="rank-foot">50% qualità + 50% velocità normalizzata sul generatore più veloce.</p>
        </div>
      </section>

      <section class="bench-block" aria-label="Galleria">
        <h3 class="bench-h">Gli stessi prompt, i quattro modelli <span class="bench-sub">(512² · seed fissi)</span></h3>
        <div class="bench-gallery">
          {#each irows as r (r.id)}
            <div class="bench-gallery-row">
              <div class="bench-gallery-name">{r.name}</div>
              <div class="bench-shots">
                {#each r.images as shot (shot.promptId)}
                  <figure class="bench-shot" title={shot.prompt}>
                    <img src={benchImageUrl(r.id, shot.file)} alt={shot.prompt} loading="lazy" />
                    <figcaption>{shot.promptId}</figcaption>
                  </figure>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>

      <section class="bench-block" aria-label="Metodo immagini">
        <h3 class="bench-h">Metodo e dati</h3>
        <ul class="bench-method">
          <li><strong>Velocità</strong> — {img.method?.speed ?? 'generazione reale · 512² e 1024² · cold + warm'}.</li>
          <li><strong>Qualità</strong> — {img.method?.quality ?? 'prompt fissi · giudice VLM locale · 0-10'}.</li>
          <li><strong>Hardware</strong> — {img.hardware} · misurato il {new Date(img.generatedAt).toLocaleString('it-IT')}.</li>
        </ul>
        <p class="bench-note">
          Dati grezzi e PNG in <code>outputs/benchmark-images/</code> · rigenera con <code>node scripts/bench-images.mjs</code>.
          Genera tu in <a href="#/images" onclick={(e) => { e.preventDefault(); navigate('/images') }}>Immagini</a> ·
          <a href="#/downloader">scarica modelli</a>.
        </p>
      </section>
    </section>
  {/if}
{/if}
