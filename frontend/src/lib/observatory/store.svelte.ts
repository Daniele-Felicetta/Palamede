// Palamede — Osservatorio: stato reattivo della pagina (Svelte 5 runes).
//
// Un solo oggetto `$state` per tutto, come `src/store.svelte.ts` fa per la
// Home. Il backend e' l'unica fonte dei numeri: qui non si calcola nulla, si
// tiene l'ultimo payload ricevuto e si ricorda cosa hai selezionato.
//
// Un dettaglio che conta: durante un update arriva una `update_start`, poi N
// `step`, poi `update_end`. La scena 3D deve aggiornarsi su `step` (che è il
// momento in cui i gradienti esistono) senza aspettare la fine. Per questo
// `live` tiene l'ultimo `step` separato dall'`update_end` completo.

import type {
  CompareResult,
  Graph,
  GroupStat,
  HistoryItem,
  LegendEntry,
  LoadInfo,
  ModeInfo,
  ObsConfig,
  ServerState,
  StepEvent,
  UpdateEnd,
  UpdateStart,
} from './types'

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'module'; id: string }
  | { kind: 'tensor'; name: string }
  | null

export interface Notice {
  kind: 'error' | 'info' | 'ok'
  text: string
  at: number
}

class ObservatoryStore {
  // ── collegamento ────────────────────────────────────────────────
  connected = $state(false)
  connectionNote = $state('non collegato')
  /** true quando lo stream e' aperto ma il modello non e' ancora in GPU. */
  ready = $state(false)

  // ── stato del backend ───────────────────────────────────────────
  state = $state<ServerState | null>(null)
  config = $state<ObsConfig | null>(null)
  model = $state<LoadInfo | null>(null)
  mode = $state<ModeInfo | null>(null)
  gpu = $state<ServerState['gpu'] | null>(null)
  vram = $state<ServerState['vram'] | null>(null)

  // ── grafo ───────────────────────────────────────────────────────
  graph = $state<Graph | null>(null)

  // ── l'esperimento in corso ──────────────────────────────────────
  live = $state<UpdateStart | null>(null)
  /** Ultimo optimizer step: e' il feed della scena 3D. */
  step = $state<StepEvent | null>(null)
  /** Quanti step di questo update sono già arrivati. */
  stepsSeen = $state(0)
  /** Ultimo update completo: BEFORE/AFTER, tensori, token, attenzione. */
  last = $state<UpdateEnd | null>(null)
  running = $state(false)
  paused = $state<{ step: number; steps: number } | null>(null)

  // ── selezione e viste ───────────────────────────────────────────
  selection = $state<Selection>(null)
  /** id del nodo isolato (null = vista globale). */
  isolated = $state<string | null>(null)
  /** nodo di cui la camera e' dentro (null = vista d'insieme). */
  focusNode = $state<string | null>(null)
  /** layer di cui mostrare le mappe di attenzione. */
  attentionLayer = $state<string | null>(null)
  /** token selezionato nella Token View. */
  tokenIndex = $state<number | null>(null)
  /** nome del modulo aperto nell'inspector. */
  moduleFocus = $state<string | null>(null)

  // ── cronologia ──────────────────────────────────────────────────
  history = $state<HistoryItem[]>([])
  compareA = $state<number | null>(null)
  compareB = $state<number | null>(null)
  comparison = $state<CompareResult | null>(null)

  // ── legend e avvisi ─────────────────────────────────────────────
  legend = $state<LegendEntry[]>([])
  disclaimer = $state('')
  notice = $state<Notice | null>(null)

  // ── derivati per la scena 3D ────────────────────────────────────
  /** Le statistiche per nodo che la scena deve disegnare adesso. */
  nodeStats = $derived.by<GroupStat[]>(() => {
    const s = this.step
    if (s && s.layers.length) return normalizeLayers(s.layers)
    const l = this.last
    if (l && l.layers.length) return l.layers
    return []
  })

  /** Le statistiche per modulo, per l'inspector e per il solo layer isolato. */
  moduleStats = $derived.by<GroupStat[]>(() => {
    const s = this.step
    if (s && s.modules.length) return s.modules
    const l = this.last
    if (l && l.modules.length) return l.modules
    return []
  })

  /** Tutti i tensori misurati dell'ultimo update. */
  tensorStats = $derived(this.last?.tensors ?? [])

  /** I moduli del nodo selezionato, per l'inspector. */
  selectedModules = $derived.by<GroupStat[]>(() => {
    const sel = this.selection
    const g = this.graph
    if (!sel || !g) return []
    let nodeId: string | null = null
    if (sel.kind === 'node') nodeId = sel.id
    else if (sel.kind === 'module') nodeId = sel.id.split('.modules.')[0] ?? sel.id.slice(0, sel.id.lastIndexOf('.'))
    else if (sel.kind === 'tensor') {
      const t = this.tensorStats.find((x) => x.name === sel.name)
      if (!t) return []
      nodeId = g.nodes.find((n) => n.params.includes(t.name))?.id ?? null
    }
    if (!nodeId) return []
    const ids = new Set(g.nodes.find((n) => n.id === nodeId)?.modules ?? [])
    return this.moduleStats.filter((m) => ids.has(m.id))
  })

  /** I tensori che appartengono al nodo selezionato. */
  selectedTensors = $derived.by(() => {
    const g = this.graph
    const sel = this.selection
    if (!g) return []
    let nodeId: string | null = null
    if (sel?.kind === 'node') nodeId = sel.id
    else if (sel?.kind === 'module') nodeId = sel.id.slice(0, sel.id.lastIndexOf('.'))
    else if (sel?.kind === 'tensor') {
      nodeId = g.nodes.find((n) => n.params.includes(sel.name))?.id ?? null
    }
    if (!nodeId) return []
    const node = g.nodes.find((n) => n.id === nodeId)
    if (!node) return []
    const want = new Set(node.params)
    if (sel?.kind === 'module') {
      const mod = g.modules.find((m) => m.id === sel.id)
      mod?.params.forEach((p) => want.add(p))
    }
    return this.tensorStats.filter((t) => want.has(t.name))
  })

  /** Label leggibile della selezione, per l'intestazione dell'inspector. */
  selectionLabel = $derived.by(() => {
    const sel = this.selection
    const g = this.graph
    if (!sel) return null
    if (sel.kind === 'node') return g?.nodes.find((n) => n.id === sel.id)?.label ?? sel.id
    if (sel.kind === 'module') return g?.modules.find((m) => m.id === sel.id)?.label ?? sel.id
    return sel.name
  })

  /**
   * Il nodo che contiene un modulo.
   *
   * Non si taglia la stringa a punti: gli id dei moduli sono
   * `layer.<n>.<gruppo>.<ruolo>` e `embeddings.<modulo>`, e un taglio cieco
   * sbaglierebbe appena i nomi dei gruppi contengono un punto.
   */
  nodeIdOfModule = (moduleId: string): string | null =>
    this.graph?.modules.find((m) => m.id === moduleId)?.node ?? null

  /** Il nodo che contiene un tensore. */
  nodeIdOfTensor = (name: string): string | null =>
    this.graph?.nodes.find((n) => n.params.includes(name))?.id ?? null

  /** I tensori di un modulo (non del nodo intero). */
  tensorsOfModule = (moduleId: string) => {
    const mod = this.graph?.modules.find((m) => m.id === moduleId)
    if (!mod) return []
    const want = new Set(mod.params)
    return this.tensorStats.filter((t) => want.has(t.name))
  }

  /** Seleziona un modulo dalla scena: si ricorda anche il nodo che lo contiene. */
  selectModule(id: string) {
    this.selection = { kind: 'module', id }
    this.moduleFocus = id
    this.focusNode = this.nodeIdOfModule(id)
  }

  /** Seleziona un nodo dalla scena. */
  selectNode(id: string) {
    this.selection = { kind: 'node', id }
    this.focusNode = id
  }

  /** Torna alla vista d'insieme e azzera la selezione. */
  goGlobal() {
    this.focusNode = null
    this.selection = null
    this.isolated = null
  }

  /**
   * Confronta due update. L'azione sta qui e non nel pannello perché lo stesso
   * confronto è disponibile anche dalle scorciatoie: la `api` resta
   * nell'unico posto che sa come si chiama il backend.
   */
  async doCompare(): Promise<void> {
    const a = this.compareA
    const b = this.compareB
    if (a == null || b == null) {
      this.say('info', 'scegli due aggiornamenti da confrontare')
      return
    }
    if (a === b) {
      this.say('info', 'scegli due aggiornamenti diversi')
      return
    }
    try {
      const { compare } = await import('./api')
      this.comparison = await compare(a, b)
    } catch (e) {
      this.say('error', e instanceof Error ? e.message : String(e))
    }
  }

  // ── azioni ──────────────────────────────────────────────────────
  say(kind: Notice['kind'], text: string) {
    this.notice = { kind, text, at: Date.now() }
    if (kind !== 'error') {
      setTimeout(() => {
        if (this.notice?.text === text) this.notice = null
      }, 6000)
    }
  }

  setPhase(phase: ServerState['phase'], detail = '', error: string | null = null) {
    if (!this.state) return
    this.state = { ...this.state, phase, detail, error }
  }

  select(sel: Selection) {
    this.selection = sel
    this.moduleFocus = sel?.kind === 'module' ? sel.id : this.moduleFocus
  }

  toggleIsolate(id: string) {
    this.isolated = this.isolated === id ? null : id
  }

  clear() {
    this.live = null
    this.step = null
    this.last = null
    this.running = false
    this.paused = null
    this.stepsSeen = 0
  }
}

/** I `LayerProfile` dello `step` hanno una forma diversa dai `GroupStat`. */
function normalizeLayers(rows: {
  id: string
  label: string
  grad_norm: number
  delta_norm: number
  params: number
}[]): GroupStat[] {
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    tensors: 0,
    params: r.params,
    grad_norm: r.grad_norm,
    grad_tensors: 0,
    weight_norm_before: 0,
    weight_norm_after: 0,
    delta_norm: r.delta_norm,
    delta_mean_abs: 0,
    delta_absmax: 0,
    changed_tensors: 0,
    rounded_away: 0,
    measured: true,
    rel_change_pct: 0,
    contribution_pct: null,
  }))
}

export const obs = new ObservatoryStore()
