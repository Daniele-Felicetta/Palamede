// Viewer 3D three.js (dipendenza npm locale, niente CDN).
// Estratto da 3d.svelte: crea un viewer orbitale su un <canvas> dato e carica
// GLB da base64. Il renderer riusa il contesto WebGL del canvas tra una
// generazione e l'altra (niente renderer multipli). Riusabile da qualsiasi
// pagina debba mostrare un asset (giochi compresi).

import * as THREE from 'three'

export interface Viewer3D {
  /** Mostra un GLB (data:...;base64,... o base64 nudo), centrato e inquadrato. */
  showGlb: (glbBase64: string) => Promise<void>
  /** Ferma il loop, libera renderer/controlli/objectURL. */
  dispose: () => void
}

export async function createViewer3D(canvas: HTMLCanvasElement): Promise<Viewer3D> {
  const [{ GLTFLoader }, { OrbitControls }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/controls/OrbitControls.js'),
  ])

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x14181f)
  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight),
    0.1,
    100,
  )
  camera.position.set(2, 1.6, 2.6)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  const fit = () => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight)
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  fit()

  scene.add(new THREE.AmbientLight(0xffffff, 1.4))
  const dir = new THREE.DirectionalLight(0xffffff, 2.2)
  dir.position.set(3, 5, 4)
  scene.add(dir)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  const loader = new GLTFLoader()
  let current: THREE.Group | null = null
  let currentUrl: string | null = null
  let raf = 0
  let dead = false
  const animate = () => {
    if (dead) return
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(animate)
  }
  raf = requestAnimationFrame(animate)

  return {
    async showGlb(glbBase64: string) {
      const b64 = glbBase64.includes(',') ? glbBase64.split(',')[1] : glbBase64
      const bin = atob(b64 ?? '')
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }))
      const gltf = await loader.loadAsync(url)
      if (dead) { URL.revokeObjectURL(url); return }
      if (current) { scene.remove(current); if (currentUrl) URL.revokeObjectURL(currentUrl) }
      current = gltf.scene
      currentUrl = url
      scene.add(current)
      // centra e scala il mesh per inquadrarlo
      const box = new THREE.Box3().setFromObject(current)
      const size = box.getSize(new THREE.Vector3()).length()
      const center = box.getCenter(new THREE.Vector3())
      current.position.sub(center)
      camera.position.set(size, size * 0.8, size * 1.2)
      camera.lookAt(0, 0, 0)
      fit()
    },
    dispose() {
      dead = true
      cancelAnimationFrame(raf)
      controls.dispose()
      renderer.dispose()
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    },
  }
}
