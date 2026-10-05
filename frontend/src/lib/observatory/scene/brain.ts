// Palamede — Osservatorio: la scena 3D del cervello.
//
// Cosa NON e' questo file: un'animazione cosmetica. Ogni proprietà visibile
// corrisponde a un numero che il backend ha misurato sui tensori, e il
// mapping è dichiarato anche nella legenda che il backend manda (vedi
// `LEGEND` in `backend/server.py`). I colori non sono casuali: l'unico canale
// categorico e' il tipo di layer (short-conv vs attention), tutto il resto è
// una scala di misure.
//
// I NODI NON SONO NEURONI. Un nodo è un gruppo di tensori di parametri; la
// sua dimensione è il numero di parametri del gruppo. Rappresentare 229
// milioni di parametri neurale-per-neurale sarebbe illeggibile e falso.
//
// Struttura spaziale: una spina verticale di 16 strati (Embeddings, 14 layer,
// LM Head). Ogni strato è una lastra che contiene i suoi moduli. La spina è
// il percorso dei dati in un decoder: embeddings → layer 0 → … → layer 13 →
// LM Head, con la connessione residiale dentro ogni layer.

import * as THREE from 'three'
import type { Graph, GraphModule, GraphNode, GroupStat } from '../types'

export interface BrainCallbacks {
  onPickNode: (id: string) => void
  onPickModule: (id: string) => void
  onHover: (label: string | null) => void
  onFps: (fps: number) => void
}

export interface BrainLayout {
  /** Altezza della spina: distanza fra due strati. */
  gap: number
  /** Centro di ogni strato lungo Y. */
  nodeY: Map<string, number>
  /** Posizione locale dei moduli dentro la lastra dello strato. */
  moduleLocal: Map<string, THREE.Vector3>
  /** Raggio della lastra. */
  radius: number
  span: number
}

type View = 'overview' | 'layer'

const COL = {
  embedding: new THREE.Color('#8b93ff'),
  lmHead: new THREE.Color('#c084fc'),
  conv: new THREE.Color('#34d399'),
  attention: new THREE.Color('#fbbf24'),
  frozen: new THREE.Color('#3a445c'),
  idle: new THREE.Color('#2b3550'),
}

export class Brain {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls: { update: () => void; dispose: () => void; target: THREE.Vector3; enabled: boolean } | null = null
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private root = new THREE.Group()
  private nodeMeshes = new Map<string, THREE.Mesh>()
  private moduleMeshes = new Map<string, THREE.Mesh>()
  private linkMeshes: THREE.Mesh[] = []
  private haloRings = new Map<string, THREE.Mesh>()
  private labels = new Map<string, THREE.Sprite>()
  private particles!: THREE.Points
  private particleVel!: Float32Array
  private layout: BrainLayout | null = null
  private graph: Graph | null = null
  private cb: BrainCallbacks
  private running = false
  private frame = 0
  private lastFpsAt = 0
  private frames = 0
  private view: View = 'overview'
  private isolated: string | null = null
  private selected: string | null = null
  private hovered: string | null = null
  private camGoal = new THREE.Vector3()
  private lookGoal = new THREE.Vector3()
  private look = new THREE.Vector3()
  /** Attivazione per layer (RMS reale): velocita' delle particelle. */
  private activation = new Map<number, number>()
  private maxActivation = 1e-6
  /** Bersagli dell'interpolazione: la scena insegue il dato, non lo salta. */
  private targetGlow = new Map<string, number>()
  private targetHalo = new Map<string, number>()
  private time = 0

  constructor(private canvas: HTMLCanvasElement, cb: BrainCallbacks) {
    this.cb = cb
    this.scene.background = new THREE.Color('#0a0d14')
    this.scene.fog = new THREE.Fog('#0a0d14', 60, 170)

    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 400)
    this.camera.position.set(0, 0, 90)

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(28, 40, 34)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x8b93ff, 0.9)
    rim.position.set(-30, -20, -26)
    this.scene.add(rim)

    this.scene.add(this.root)
    this.buildParticles()
    this.buildGrid()
  }

  // ── costruzione ─────────────────────────────────────────────────
  async init(): Promise<void> {
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.resize()
    const c = new OrbitControls(this.camera, this.renderer.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.07
    c.minDistance = 6
    c.maxDistance = 220
    c.target.set(0, 0, 0)
    this.controls = c as unknown as typeof this.controls
    this.look.copy(c.target)

    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.start()
  }

  /** Griglia di riferimento: dà scala e profondità alla scena. */
  private buildGrid(): void {
    const g = new THREE.GridHelper(120, 24, 0x1b2436, 0x141a28)
    g.position.y = -46
    this.scene.add(g)
  }

  /**
   * Particelle che scorrono lungo la spina.
   *
   * La velocità è proporzionale all'attivazione reale del layer di partenza
   * (RMS dell'uscita agganciata dall'hook): dove il segnale è forte il moto
   * è veloce. Non sono particelle "animate": sono un rendering di un numero.
   */
  private buildParticles(): void {
    const N = 420
    const pos = new Float32Array(N * 3)
    this.particleVel = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] = -46 + Math.random() * 92
      pos[i * 3] = (Math.random() - 0.5) * 7
      pos[i * 3 + 2] = (Math.random() - 0.5) * 7
      this.particleVel[i] = 0.6 + Math.random() * 1.4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: 0x8b93ff,
      size: 0.55,
      transparent: true,
      opacity: 0.75,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.particles = new THREE.Points(geo, mat)
    this.scene.add(this.particles)
  }

  // ── layout ──────────────────────────────────────────────────────
  /**
   * Dispose gli strati lungo Y e i moduli sulla superficie della lastra.
   *
   * L'ordine dei moduli dentro uno strato segue il percorso reale dei dati di
   * un decoder layer: `norm.operator → (attention | short conv) → norm.ffn →
   * MLP`, con la connessione residurale che aggiunge tutto al residuo. Non è
   * un ordine estetico: è `Lfm2DecoderLayer.forward`.
   */
  layoutGraph(graph: Graph): BrainLayout {
    const n = graph.nodes.length
    const gap = 6.4
    const nodeY = new Map<string, number>()
    const y0 = ((n - 1) * gap) / 2
    graph.nodes.forEach((node, i) => nodeY.set(node.id, y0 - i * gap))

    // Raggio costante della lastra: la variazione vera tra 67M di parametri
    // (embeddings) e 12M (un layer) sta nel modulo, non nello spessore della
    // lastra. Far dipendere il raggio dalla radice dei parametri faceva
    // sembrare gli embeddings una palla che conteneva tutto il resto.
    const radius = 9

    const moduleLocal = new Map<string, THREE.Vector3>()
    for (const node of graph.nodes) {
      const mods = graph.modules.filter((m) => m.node === node.id)
      this.placeModules(mods, radius, moduleLocal)
    }

    this.layout = {
      gap,
      nodeY,
      moduleLocal,
      radius,
      span: (n - 1) * gap,
    }
    return this.layout
  }

  /**
   * I moduli di uno strato su una griglia ellittica, raggruppati per gruppo
   * (attenzione/conv da una parte, MLP dall'altra, norm in alto). Le celle
   * vuote non esistono: la griglia si adatta ai moduli che ci sono davvero.
   */
  private placeModules(
    mods: GraphModule[],
    radius: number,
    out: Map<string, THREE.Vector3>,
  ): void {
    const byGroup = new Map<string, GraphModule[]>()
    for (const m of mods) {
      const arr = byGroup.get(m.group) ?? []
      arr.push(m)
      byGroup.set(m.group, arr)
    }
    const order = ['norm', 'attn', 'conv', 'feed_forward'].filter((g) => byGroup.has(g))
    const rows = order.length || 1
    const zSpan = radius * 1.5
    order.forEach((group, gi) => {
      const list = byGroup.get(group)!
      const z = rows === 1 ? 0 : (gi / (rows - 1) - 0.5) * zSpan
      const cols = Math.min(list.length, 5)
      const rowsHere = Math.ceil(list.length / cols)
      list.forEach((m, i) => {
        const cx = i % cols
        const cy = Math.floor(i / cols)
        const x = rowsHere === 1 ? 0 : (cx / (cols - 1) - 0.5) * radius * 1.7
        const y = rowsHere === 1 ? 0 : (cy / (rowsHere - 1) - 0.5) * 4.2
        out.set(m.id, new THREE.Vector3(x, y, z))
      })
    })
  }

  // ── grafo → geometria ───────────────────────────────────────────
  setGraph(graph: Graph): void {
    this.disposeGraph()
    this.graph = graph
    const L = this.layoutGraph(graph)

    for (const node of graph.nodes) {
      const y = L.nodeY.get(node.id) ?? 0
      const isAlias = node.params_aliased
      const s = nodeScale(node, L.radius)

      const geo = node.kind === 'layer'
        ? new THREE.BoxGeometry(s * 2, 1.5, s * 2)
        : new THREE.CylinderGeometry(s, s, 2.1, 28)
      const mat = new THREE.MeshStandardMaterial({
        color: nodeColor(node).clone(),
        emissive: new THREE.Color('#000000'),
        roughness: 0.44,
        metalness: 0.15,
        transparent: isAlias,
        opacity: isAlias ? 0.42 : 1,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(0, y, 0)
      mesh.userData = { kind: 'node', id: node.id, base: s }
      this.root.add(mesh)
      this.nodeMeshes.set(node.id, mesh)

      // alone della variazione relativa: spessore = |δ|/‖w‖
      const ringGeo = new THREE.TorusGeometry(s * 1.32, 0.16, 8, 44)
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x8b93ff,
        transparent: true,
        opacity: 0,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.set(0, y, 0)
      this.root.add(ring)
      this.haloRings.set(node.id, ring)

      for (const modId of node.modules) {
        const mod = graph.modules.find((m) => m.id === modId)
        if (!mod) continue
        const local = L.moduleLocal.get(modId) ?? new THREE.Vector3()
        const ms = moduleScale(mod)
        const mg = new THREE.BoxGeometry(ms * 1.7, ms * 1.7, ms * 1.7)
        const mm = new THREE.MeshStandardMaterial({
          color: nodeColor(node).clone().multiplyScalar(0.85),
          emissive: new THREE.Color('#000000'),
          roughness: 0.38,
          metalness: 0.22,
        })
        const mm3 = new THREE.Mesh(mg, mm)
        mm3.position.set(local.x, y + local.y, local.z)
        mm3.userData = { kind: 'module', id: mod.id, base: ms, node: node.id }
        this.root.add(mm3)
        this.moduleMeshes.set(mod.id, mm3)
      }
    }

    this.buildLinks(graph, L)
    this.frameAll()
  }

  /** I collegamenti sono cilindri, non linee: lo spessore deve poter variare. */
  private buildLinks(graph: Graph, L: BrainLayout): void {
    for (const link of graph.links) {
      const y0 = L.nodeY.get(link.from) ?? 0
      const y1 = L.nodeY.get(link.to) ?? 0
      const h = Math.abs(y0 - y1)
      const geo = new THREE.CylinderGeometry(0.16, 0.16, h, 8, 1, true)
      const mat = new THREE.MeshBasicMaterial({
        color: 0x3d4a6b,
        transparent: true,
        opacity: 0.7,
      })
      const m = new THREE.Mesh(geo, mat)
      m.position.set(0, (y0 + y1) / 2, 0)
      m.userData = { kind: 'link', from: link.from, to: link.to, base: 0.16 }
      this.root.add(m)
      this.linkMeshes.push(m)
    }
  }

  private disposeGraph(): void {
    for (const m of [...this.nodeMeshes.values(), ...this.moduleMeshes.values(), ...this.linkMeshes, ...this.haloRings.values()]) {
      this.root.remove(m)
      m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat.dispose()
    }
    for (const s of this.labels.values()) {
      this.root.remove(s)
      s.material.map?.dispose()
      s.material.dispose()
    }
    this.nodeMeshes.clear()
    this.moduleMeshes.clear()
    this.haloRings.clear()
    this.linkMeshes = []
    this.labels.clear()
    this.targetGlow.clear()
    this.targetHalo.clear()
  }

  // ── dati → aspetto ──────────────────────────────────────────────
  /**
   * Aggiorna l'aspetto dai dati misurati.
   *
   * `nodeStats` arriva a ogni `step`, quindi la scena si muove DURANTE il
   * training e non solo alla fine. Il log in base 1 non e' un vezzo
   * estetico: le norme di gradiente in una rete vera coprono ordini di
   * grandezza diversi (0.004 → 286 in questo modello) e su scala lineare
   * tutto tranne il picco resterebbe nero.
   */
  setStats(nodes: GroupStat[], modules: GroupStat[]): void {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const gmax = Math.max(...nodes.map((n) => n.grad_norm || 0), 1e-9)
    const hmax = Math.max(...nodes.map((n) => n.rel_change_pct || 0), 1e-12)

    for (const node of this.graph?.nodes ?? []) {
      const st = byId.get(node.id)
      this.targetHalo.set(node.id, st ? log1p((st.rel_change_pct || 0) / hmax) : 0)
      if (!st || !st.measured) {
        this.targetGlow.set(node.id, 0)
        continue
      }
      this.targetGlow.set(node.id, log1p(st.grad_norm / gmax))
    }

    const mById = new Map(modules.map((m) => [m.id, m]))
    const mgmax = Math.max(...modules.map((m) => m.grad_norm || 0), 1e-9)
    for (const id of this.moduleMeshes.keys()) {
      const st = mById.get(id)
      // un modulo non trainato (in LoRa) resta spento: `measured` è false
      this.targetGlow.set(id, st && st.measured ? log1p((st.grad_norm || 0) / mgmax) : 0)
    }
  }

  /** Attivazioni reali per layer: pilotano la velocità delle particelle. */
  setActivations(acts: Record<string, { rms: number }>): void {
    this.activation.clear()
    let mx = 1e-6
    for (const [k, v] of Object.entries(acts)) {
      const i = Number(k)
      if (!Number.isFinite(i)) continue
      this.activation.set(i, v.rms)
      if (v.rms > mx) mx = v.rms
    }
    this.maxActivation = mx
  }

  // ── selezione e viste ───────────────────────────────────────────
  setSelection(nodeOrModuleId: string | null): void {
    this.selected = nodeOrModuleId
  }

  setIsolated(id: string | null): void {
    this.isolated = id
  }

  /** Vista corrente: la UI la usa per il pulsante "vista globale". */
  get currentView(): View {
    return this.view
  }

  /** Vista globale, o dentro uno strato. */
  focus(nodeId: string | null): void {
    this.view = nodeId ? 'layer' : 'overview'
    if (!this.layout) return
    if (!nodeId) {
      this.camGoal.set(0, 0, Math.max(58, this.layout.span * 1.5))
      this.lookGoal.set(0, 0, 0)
      this.clearLabels()
      this.root.visible = true
      return
    }
    const y = this.layout.nodeY.get(nodeId) ?? 0
    this.camGoal.set(0, y, 24)
    this.lookGoal.set(0, y, 0)
    this.showLabels(nodeId)
  }

  /** Etichette solo per lo strato aperto: 130 sprite sempre sarebbero sporchi. */
  private showLabels(nodeId: string): void {
    this.clearLabels()
    const node = this.graph?.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const L = this.layout!
    const y = L.nodeY.get(nodeId) ?? 0
    for (const modId of node.modules) {
      const mod = this.graph!.modules.find((m) => m.id === modId)
      const local = L.moduleLocal.get(modId)
      if (!mod || !local) continue
      const s = makeLabel(mod.label)
      s.position.set(local.x, y + local.y + moduleScale(mod) * 1.9 + 0.9, local.z)
      s.scale.set(9.5, 1.5, 1)
      this.root.add(s)
      this.labels.set(modId, s)
    }
  }

  private clearLabels(): void {
    for (const s of this.labels.values()) {
      this.root.remove(s)
      s.material.map?.dispose()
      s.material.dispose()
    }
    this.labels.clear()
  }

  private frameAll(): void {
    if (!this.layout) return
    this.focus(null)
  }

  // ── picking ─────────────────────────────────────────────────────
  private onPointerMove = (ev: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(
      [...this.nodeMeshes.values(), ...this.moduleMeshes.values()],
      false,
    )
    const id = (hits[0]?.object.userData?.id as string | undefined) ?? null
    if (id !== this.hovered) {
      this.hovered = id
      this.canvas.style.cursor = id ? 'pointer' : 'grab'
      const u = hits[0]?.object.userData
      if (!id) this.cb.onHover(null)
      else if (u?.kind === 'node') {
        const n = this.graph?.nodes.find((x) => x.id === id)
        this.cb.onHover(n ? `${n.label} — ${n.params.length} tensori` : id)
      } else {
        const m = this.graph?.modules.find((x) => x.id === id)
        this.cb.onHover(m ? `${m.label} — ${m.params.length} tensori` : id)
      }
    }
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return
    this.downX = ev.clientX
    this.downY = ev.clientY
    this.pendingPick = true
  }

  /**
   * Il click si distingue dal drag sulla fine del gesto, non all'inizio: qui
   * si confronta la posizione del rilascio con quella della pressione. Se il
   * raycast lo facesse alla pressione, orbitando trascinando un nodo lo
   * selezionerebbe mentre si sta solo muovendo la camera.
   */
  private onPointerUp = (ev: PointerEvent) => {
    if (ev.button !== 0) return
    const pending = this.pendingPick
    this.pendingPick = false
    if (!pending || this.downX == null || this.downY == null) return
    if (Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY) > 4) return

    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(
      [...this.nodeMeshes.values(), ...this.moduleMeshes.values()],
      false,
    )
    const u = hits[0]?.object.userData
    if (!u) return
    if (u.kind === 'node') this.cb.onPickNode(u.id)
    else if (u.kind === 'module') this.cb.onPickModule(u.id)
  }

  private downX: number | null = null
  private downY: number | null = null
  private pendingPick = false

  // ── loop ────────────────────────────────────────────────────────
  start(): void {
    if (this.running) return
    this.running = true
    this.lastFpsAt = performance.now()
    const tick = () => {
      if (!this.running) return
      this.frame = requestAnimationFrame(tick)
      this.update()
      this.renderer.render(this.scene, this.camera)
      this.frames++
      const now = performance.now()
      if (now - this.lastFpsAt >= 500) {
        this.cb.onFps((this.frames * 1000) / (now - this.lastFpsAt))
        this.frames = 0
        this.lastFpsAt = now
      }
    }
    this.frame = requestAnimationFrame(tick)
  }

  private update(): void {
    const dt = 1 / 60
    this.time += dt

    // camera: interpolazione verso il bersaglio (viste globali/strato)
    this.camera.position.lerp(this.camGoal, 0.055)
    this.look.lerp(this.lookGoal, 0.08)
    if (this.controls) {
      this.controls.target.copy(this.look)
      this.controls.update()
    }

    // nodi: bagliore (gradiente), alone (variazione relativa), pulsazione
    for (const [id, mesh] of this.nodeMeshes) {
      const g = this.targetGlow.get(id) ?? 0
      const h = this.targetHalo.get(id) ?? 0
      const aliased = this.graph?.nodes.find((n) => n.id === id)?.params_aliased ?? false
      const dim = this.isolated && this.isolated !== id ? 0.16 : 1
      // la scala pulsa col gradiente: il dato è "quanto si muove", quindi
      // anche il volume del nodo deve muoversi con lui
      const want = 1 + g * 0.14
      mesh.scale.setScalar(mesh.scale.x + (want - mesh.scale.x) * 0.12)
      mesh.rotation.y += dt * 0.12 * (1 + g * 2)

      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.emissive.copy(nodeColor(this.graph?.nodes.find((n) => n.id === id)!))
        .multiplyScalar(g * 1.35 * dim)
      mat.opacity = (this.isolated && this.isolated !== id ? 0.2 : 1) * (aliased ? 0.42 : 1)

      const ring = this.haloRings.get(id)
      if (ring) {
        const rmat = ring.material as THREE.MeshBasicMaterial
        rmat.opacity = h * 0.85 * dim
        ring.rotation.z += dt * 0.5
        ring.scale.setScalar(1 + h * 0.12)
      }
    }

    // moduli: bagliore dal gradiente, fade se isolati
    for (const [id, mesh] of this.moduleMeshes) {
      const g = this.targetGlow.get(id) ?? 0
      const nodeId = mesh.userData.node as string
      const dim = this.isolated && this.isolated !== nodeId ? 0.12 : 1
      const sel = this.selected === id ? 1 : 0
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.emissive.copy(nodeColor(this.graph!.nodes.find((n) => n.id === nodeId)!))
        .multiplyScalar((g * 1.6 + sel * 0.5) * dim)
      mat.opacity = dim
      const want = 1 + g * 0.55 + sel * 0.2
      mesh.scale.setScalar(mesh.scale.x + (want - mesh.scale.x) * 0.14)
    }

    // collegamenti: spessore dal gradiente aggregato sui due capi
    for (const l of this.linkMeshes) {
      const from = l.userData.from as string
      const to = l.userData.to as string
      const a = this.targetGlow.get(from) ?? 0
      const b = this.targetGlow.get(to) ?? 0
      const g = Math.max(a, b)
      const dim = this.isolated && this.isolated !== from && this.isolated !== to ? 0.1 : 1
      l.scale.x = l.scale.z = 0.7 + g * 2.6
      const mat = l.material as THREE.MeshBasicMaterial
      mat.opacity = (0.32 + g * 0.6) * dim
      mat.color.setHex(g > 0.05 ? 0x8b93ff : 0x3d4a6b)
    }

    // particelle: velocità proporzionale all'attivazione reale del layer
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const span = this.layout?.span ?? 40
    for (let i = 0; i < this.particleVel.length; i++) {
      const y = arr[i * 3 + 1]
      const layerIdx = Math.round(((span / 2 - y) / (this.layout?.gap ?? 6.4)))
      const act = this.activation.get(layerIdx) ?? 0
      const speed = this.particleVel[i] * (0.25 + (act / this.maxActivation) * 2.6)
      arr[i * 3 + 1] = y + speed * dt * 7
      if (arr[i * 3 + 1] > span / 2 + 2) arr[i * 3 + 1] = -span / 2 - 2
    }
    pos.needsUpdate = true
    const pm = this.particles.material as THREE.PointsMaterial
    pm.opacity = this.isolated ? 0.25 : 0.75
  }

  // ── ciclo di vita ───────────────────────────────────────────────
  resize(): void {
    if (!this.renderer) return
    const w = Math.max(1, this.canvas.clientWidth)
    const h = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.running = false
    cancelAnimationFrame(this.frame)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.controls?.dispose()
    this.disposeGraph()
    this.particles.geometry.dispose()
    ;(this.particles.material as THREE.Material).dispose()
    this.renderer?.dispose()
  }
}

// ── scale e colori ────────────────────────────────────────────────────
function log1p(x: number): number {
  if (!(x > 0)) return 0
  const m = Math.log1p(x)
  return Math.max(0, Math.min(1, m))
}

function nodeColor(node: GraphNode): THREE.Color {
  if (!node) return COL.idle
  if (node.kind === 'embedding') return COL.embedding
  if (node.kind === 'lm_head') return COL.lmHead
  return node.layer_type === 'conv' ? COL.conv : COL.attention
}

/** Raggio di una lastra: radice dei parametri, non il numero grezzo. */
function nodeScale(node: GraphNode, radius: number): number {
  if (node.kind !== 'layer') return radius * 0.72
  const n = Math.sqrt(node.numel || 1)
  return radius * (0.42 + 0.42 * (n / 3500))
}

function moduleScale(mod: GraphModule): number {
  const n = Math.sqrt(mod.numel || 1)
  return 0.75 + Math.min(1.5, n / 1500)
}

/** Etichetta come sprite: testo su canvas, nessun font da rete. */
function makeLabel(text: string): THREE.Sprite {
  const pad = 12
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const font = '600 34px system-ui, sans-serif'
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  c.width = w
  c.height = 52
  const g = c.getContext('2d')!
  g.font = font
  g.fillStyle = 'rgba(10,13,20,0.82)'
  g.strokeStyle = 'rgba(139,147,255,0.5)'
  g.lineWidth = 2
  const r = 10
  g.beginPath()
  g.roundRect(1, 1, w - 2, 50, r)
  g.fill()
  g.stroke()
  g.fillStyle = '#e7ebf3'
  g.textBaseline = 'middle'
  g.fillText(text, pad, 27)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const s = new THREE.Sprite(mat)
  s.renderOrder = 10
  return s
}
