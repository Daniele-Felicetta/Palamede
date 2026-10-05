<script lang="ts">
  // Palamede — Osservatorio: i comandi dell'esperimento.
  //
  // Qui vive l'unico modo per cambiare il comportamento del modello: un
  // esempio (prompt + target), quanti optimizer step, e le impostazioni che
  // il backend accetta. Ogni controllo è dichiarato anche in `backend/config.py`
  // e la validazione è lì, non qui: se il backend rifiuta un valore, il
  // messaggio di errore finisce sotto e non viene silenziato.

  import { Button, Field, Hintline, Stamp } from '../../../components/ui'
  import { obs } from '../store.svelte'
  import {
    clearHistory, generate, loadModel, resetModel, saveConfig, stepAdvance, train,
  } from '../api'
  import { ObservatoryError } from '../api'

  let prompt = $state('Il gatto dorme sul')
  let target = $state(' tappeto')
  let busy = $state(false)
  let generating = $state(false)
  let probing = $state<{ text: string; tps: number } | null>(null)

  const cfg = $derived(obs.config)
  const loaded = $derived(!!obs.state?.loaded)
  const canTrain = $derived(loaded && !busy && !generating)
  const isLora = $derived(cfg?.mode === 'LORA')
  const paused = $derived(obs.state?.phase === 'paused')

  async function guard(fn: () => Promise<void>) {
    busy = true
    try {
      await fn()
    } catch (e) {
      const msg =
        e instanceof ObservatoryError ? e.message : e instanceof Error ? e.message : String(e)
      obs.say('error', msg)
    } finally {
      busy = false
    }
  }

  async function doLoad() {
    await guard(async () => {
      const r = await loadModel()
      const m = r.model as { load_ms?: number } | null
      obs.say('ok', `modello in GPU${m?.load_ms ? ` in ${m.load_ms} ms` : ''}`)
    })
  }

  async function doTrain() {
    await guard(async () => {
      const r = await train(prompt, target)
      obs.say(
        'ok',
        `update #${r.update.index}: loss ${r.update.loss_before.toFixed(3)} → ${r.update.loss_after.toFixed(3)} in ${Math.round(r.update.timing.total_ms)} ms`,
      )
    })
  }

  async function doGenerate() {
    generating = true
    try {
      const r = await generate(prompt)
      probing = { text: r.text, tps: r.tokens_per_second }
    } catch (e) {
      obs.say('error', e instanceof Error ? e.message : String(e))
    } finally {
      generating = false
    }
  }

  async function doReset() {
    await guard(async () => {
      await resetModel()
      obs.say('ok', 'pesi tornati a quelli del checkpoint su disco')
    })
  }

  async function doClear() {
    await guard(async () => {
      await clearHistory()
      obs.compareA = null
      obs.compareB = null
      obs.comparison = null
      obs.say('ok', 'cronologia azzerata (i pesi non sono cambiati)')
    })
  }

  async function patch(p: Record<string, unknown>) {
    try {
      await saveConfig(p as never)
    } catch (e) {
      obs.say('error', e instanceof Error ? e.message : String(e))
    }
  }

  function onLoraTarget(e: Event) {
    const el = e.currentTarget as HTMLInputElement
    const list = Array.from(
      el.closest('.obs-lora-list')!.querySelectorAll<HTMLInputElement>('input[type=checkbox]'),
    )
      .filter((x) => x.checked)
      .map((x) => x.value)
    void patch({ lora: { ...cfg!.lora, target_modules: list } })
  }
</script>

<section class="obs-controls">
  <!-- ── stato ─────────────────────────────────────────────────── -->
  <header class="obs-ctl-head">
    <Stamp hot={obs.state?.phase === 'training' || paused}>
      {obs.state?.phase === 'training'
        ? 'allenamento'
        : paused
          ? 'in pausa'
          : obs.state?.phase === 'loading'
            ? 'caricamento'
            : 'pronto'}
    </Stamp>
    <span class="obs-ctl-model">
      LFM2.5 230M
      {#if obs.state}
        · {obs.state.mode} · {obs.state.precision}
      {/if}
    </span>
  </header>

  {#if !loaded}
    <p class="obs-hint">
      Il checkpoint non è in GPU. <strong>Carica</strong> per mettere i 229
      milioni di parametri sulla scheda (circa 2 s e 5 GB di VRAM).
    </p>
    <Button onclick={doLoad} disabled={busy}>Carica LFM2.5 230M</Button>
  {:else}
    <div class="obs-ctl-load">
      <span title="parametri base del checkpoint">
        {obs.model ? `${(obs.model.base_params / 1e6).toFixed(1)}M` : '—'} base
      </span>
      {#if obs.model && obs.model.adapter_params > 0}
        <span title="parametri aggiunti dagli adapter LoRa">
          +{(obs.model.adapter_params / 1e6).toFixed(2)}M adapter
        </span>
      {/if}
      <span class="dim" title="tempo di caricamento misurato">
        {obs.model ? `${Math.round(obs.model.load_ms)} ms` : ''}
      </span>
    </div>
  {/if}

  <!-- ── l'esempio ─────────────────────────────────────────────── -->
  <div class="obs-example">
    <div class="obs-ex-head">
      <span class="obs-ex-n">
        EXAMPLE #{obs.state?.updates ?? 0}
      </span>
      {#if obs.last}
        <span class="obs-ex-steps">
          {obs.last.steps} step · {Math.round(obs.last.timing.total_ms)} ms
        </span>
      {/if}
    </div>

    <Field label="Input (prompt)">
      <textarea
        bind:value={prompt}
        rows="2"
        spellcheck="false"
        placeholder="Il gatto dorme sul"
      ></textarea>
    </Field>

    <Field label="Target (la risposta che vuoi insegnare)">
      <textarea
        bind:value={target}
        rows="2"
        spellcheck="false"
        placeholder=" tappeto"
      ></textarea>
    </Field>

    <div class="obs-train-row">
      <Button onclick={doTrain} disabled={!canTrain || !prompt.trim() || !target.trim()}>
        {obs.state?.phase === 'training' ? 'allenamento…' : `TRAIN ${cfg?.steps ?? 1} step`}
      </Button>
      {#if paused}
        <Button variant="ghost" onclick={() => stepAdvance()}>prossimo step ▸</Button>
      {:else}
        <Button variant="ghost" onclick={doGenerate} disabled={!loaded || generating}>
          {generating ? 'genera…' : 'solo inferenza'}
        </Button>
      {/if}
    </div>

    <Hintline>
      La perdita è calcolata <strong>solo sui token del target</strong>: il prompt
      serve da contesto, non da risposta.
    </Hintline>

    {#if probing}
      <div class="obs-probe">
        <span class="obs-probe-t">inferenza, senza allenare</span>
        <output>{probing.text || '(vuoto)'}</output>
        <span class="dim">{probing.tps.toFixed(1)} tok/s</span>
      </div>
    {/if}
  </div>

  <!-- ── impostazioni ──────────────────────────────────────────── -->
  <details class="obs-adv">
    <summary>impostazioni</summary>

    <div class="obs-grid2">
      <Field label="modalità">
        <select
          value={cfg?.mode ?? 'FULL'}
          onchange={(e) => patch({ mode: (e.currentTarget as HTMLSelectElement).value })}
        >
          <option value="FULL">FULL — tutti i parametri</option>
          <option value="LORA">LoRa — solo gli adapter</option>
        </select>
      </Field>

      <Field label="precisione">
        <select
          value={cfg?.precision ?? 'mixed'}
          onchange={(e) => patch({ precision: (e.currentTarget as HTMLSelectElement).value })}
        >
          <option value="mixed">mixed — fp32 master + bf16</option>
          <option value="bf16">bf16 — più veloce, delta che si azzerano</option>
          <option value="fp32">fp32 — più lento, nessuna perdita</option>
        </select>
      </Field>

      <Field label="step per esempio">
        <input
          type="number"
          min="1"
          max="10"
          value={cfg?.steps ?? 1}
          onchange={(e) =>
            patch({ steps: Number((e.currentTarget as HTMLInputElement).value) })}
        />
      </Field>

      <Field label="animazione">
        <select
          value={cfg?.animation_mode ?? 'live'}
          onchange={(e) => patch({ animation_mode: (e.currentTarget as HTMLSelectElement).value })}
        >
          <option value="live">LIVE — gli step scorrono</option>
          <option value="step">STEP-BY-STEP — fermo su ogni update</option>
        </select>
      </Field>

      <Field label={isLora ? 'learning rate (LoRa)' : 'learning rate'}>
        <input
          type="number"
          step="0.00001"
          min="0.0000001"
          value={isLora ? cfg?.lora_learning_rate : cfg?.learning_rate}
          onchange={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value)
            void patch(isLora ? { lora_learning_rate: v } : { learning_rate: v })
          }}
        />
      </Field>

      <Field label="gradient clip (0 = off)">
        <input
          type="number"
          step="0.1"
          min="0"
          value={cfg?.grad_clip ?? 1}
          onchange={(e) => patch({ grad_clip: Number((e.currentTarget as HTMLInputElement).value) })}
        />
      </Field>

      <Field label="token da generare (BEFORE/AFTER)">
        <input
          type="number"
          min="1"
          max="200"
          value={cfg?.max_new_tokens ?? 24}
          onchange={(e) =>
            patch({ max_new_tokens: Number((e.currentTarget as HTMLInputElement).value) })}
        />
      </Field>

      <Field label="lunghezza massima">
        <input
          type="number"
          min="8"
          max="2048"
          step="8"
          value={cfg?.max_seq_len ?? 128}
          onchange={(e) => patch({ max_seq_len: Number((e.currentTarget as HTMLInputElement).value) })}
        />
      </Field>
    </div>

    {#if isLora && cfg}
      <h4>LoRa</h4>
      <div class="obs-grid2">
        <Field label="rank">
          <input
            type="number"
            min="1"
            max="256"
            value={cfg.lora.rank}
            onchange={(e) =>
              patch({ lora: { ...cfg.lora, rank: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </Field>
        <Field label="alpha">
          <input
            type="number"
            min="1"
            step="1"
            value={cfg.lora.alpha}
            onchange={(e) =>
              patch({ lora: { ...cfg.lora, alpha: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </Field>
        <Field label="dropout">
          <input
            type="number"
            min="0"
            max="0.9"
            step="0.05"
            value={cfg.lora.dropout}
            onchange={(e) =>
              patch({ lora: { ...cfg.lora, dropout: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </Field>
      </div>

      <div class="obs-lora-list" onchange={onLoraTarget}>
        <span class="obs-lora-cap">moduli target</span>
        {#each ['q_proj', 'k_proj', 'v_proj', 'out_proj', 'w1', 'w2', 'w3', 'in_proj'] as t (t)}
          <label>
            <input type="checkbox" value={t} checked={cfg.lora.target_modules.includes(t)} />
            <code>{t}</code>
          </label>
        {/each}
      </div>
      <Hintline>
        <code>w1</code>=gate · <code>w3</code>=up · <code>w2</code>=down (nomi di LFM2)
      </Hintline>
    {/if}

    <h4>cattura</h4>
    <div class="obs-lora-list">
      {#each [['collect_activations', 'attivazioni per layer'], ['collect_attention', 'mappe di attenzione'], ['collect_per_token', 'dettaglio per token']] as [k, label] (k)}
        <label>
          <input
            type="checkbox"
            checked={!!cfg?.[k as 'collect_activations']}
            onchange={(e) =>
              patch({ [k]: (e.currentTarget as HTMLInputElement).checked })}
          />
          {label}
        </label>
      {/each}
      <label title="senza attenzione il modello usa sdpa, più veloce">
        <input
          type="checkbox"
          checked={cfg?.weight_snapshot_keep === 0}
          onchange={(e) => {
            const on = (e.currentTarget as HTMLInputElement).checked
            void patch({ weight_snapshot_keep: on ? 0 : 2 })
          }}
        />
        solo statistiche (niente copie dei pesi)
      </label>
    </div>
    <Hintline>
      Le mappe di attenzione impongono <code>eager</code> invece di <code>sdpa</code>:
      costa circa 2 ms in più su una sequenza corta, e <code>sdpa</code> le rifiuta
      del tutto.
    </Hintline>
  </details>

  <!-- ── manutenzione ──────────────────────────────────────────── -->
  <div class="obs-maint">
    <Button variant="ghost" onclick={doReset} disabled={!loaded || busy}>
      azzera i pesi
    </Button>
    <Button variant="ghost" onclick={doClear} disabled={busy || obs.history.length === 0}>
      svuota cronologia
    </Button>
  </div>

  {#if obs.mode?.lora}
    <p class="obs-lora-stat">
      {obs.mode.lora.adapters} adapter · {obs.mode.lora.trainable_params.toLocaleString('it-IT')}
      param trainabili ({((100 * obs.mode.lora.trainable_params) / (obs.mode.lora.trainable_params + obs.mode.lora.frozen_params)).toFixed(2)}%)
      {#if obs.mode.lora.missing_targets.length}
        · target inesistenti: {obs.mode.lora.missing_targets.join(', ')}
      {/if}
    </p>
  {/if}
</section>
