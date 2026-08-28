import { ReactNode, useState } from 'react'
import { useStore } from '../store'
import { useHashRoute } from '../router'

const NAV = [
  { path: '/', label: 'Officina', live: true },
  { path: '/images', label: 'Immagini', live: true },
  { path: '/text', label: 'Testo', live: false },
  { path: '/video', label: 'Video', live: false },
  { path: '/3d', label: '3D', live: false },
  { path: '/rag', label: 'RAG', live: false },
  { path: '/mcp', label: 'MCP', live: false },
]

function Meter({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="meter">
      <div className="meter-top">
        <span className="meter-lab">{label}</span>
        <span className="meter-val">{value.toFixed(1)}{unit}</span>
      </div>
      <div className="meter-bar"><span className="meter-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const [route, navigate] = useHashRoute()
  const { health, metrics, current, modelLabel } = useStore()
  const [sidebar, setSidebar] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : true)

  const gpuOk = metrics?.gpu.ok
  const loaded = current

  return (
    <div className={sidebar ? 'shell shell-sidebar' : 'shell'}>
      <header className="masthead">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate('/') }}>
          <span className="seal">P</span>
          Palamede
        </a>
        <nav className="nav" aria-label="Sezioni">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={'#' + n.path}
              className={(route === n.path ? 'active ' : '') + (n.live ? '' : 'disabled')}
              onClick={(e) => { e.preventDefault(); navigate(n.path) }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="beacon">
          <span className="led-row" title="Modello caricato sulla GPU">
            <span className={`led ${health?.ok ? 'on' : 'off'}`} aria-hidden />
            {loaded ? modelLabel(loaded) : 'GPU idle'}
          </span>
        </div>
        <button
          className="side-toggle"
          onClick={() => setSidebar((s) => !s)}
          title="Mostra/nascondi metriche"
          aria-pressed={sidebar}
        >
          {sidebar ? '▸ nascondi' : '◂ metriche'}
        </button>
      </header>

      {sidebar && (
        <aside className="sidebar" aria-label="Metriche di sistema">
          <div className="side-sec">
            <div className="side-title">Sistema</div>
            <Meter label="CPU" value={metrics?.cpu ?? 0} max={100} unit="%" />
            <Meter label="RAM" value={metrics?.ram.usedGB ?? 0} max={metrics?.ram.totalGB ?? 1} unit=" GB" />
          </div>
          <div className="side-sec">
            <div className="side-title">GPU</div>
            {gpuOk ? (
              <>
                <Meter label="Uso" value={metrics!.gpu.utilPct} max={100} unit="%" />
                <Meter label="VRAM" value={metrics!.gpu.vramUsedGB} max={metrics!.gpu.vramTotalGB} unit=" GB" />
                <div className="side-mini">
                  <span>temp {metrics!.gpu.tempC}°C</span>
                  <span>power {metrics!.gpu.powerW}W</span>
                </div>
              </>
            ) : (
              <div className="side-mini off">nvidia-smi non disponibile</div>
            )}
          </div>
          <div className="side-sec">
            <div className="side-title">Modello</div>
            <div className={`loaded-model ${loaded ? 'on' : ''}`}>
              <span className="led on" aria-hidden />
              {loaded ? modelLabel(loaded) : 'nessuno'}
            </div>
          </div>
          {(metrics?.gpu.procs?.length ?? 0) > 0 && (
            <div className="side-sec">
              <div className="side-title">Processi GPU</div>
              {metrics!.gpu.procs.map((p, i) => (
                <div className="side-mini" key={i}>
                  <span>{p.name}</span>
                  <span>{p.mem}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      <main>{children}</main>
      <footer>
        <span>Palamede — officina locale · RTX 5060 Ti 16GB</span>
        <span>modello server :8000 · hub :4600</span>
      </footer>
    </div>
  )
}