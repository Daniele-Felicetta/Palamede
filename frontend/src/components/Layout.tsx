import { ReactNode, useEffect, useState } from 'react'
import { useStore } from '../store'
import { useHashRoute } from '../router'

// Marcatore di build: compare nel footer, cosi' si capisce subito se il
// browser sta servendo un bundle vecchio (in tal caso: Ctrl+F5).
export const BUILD = 'v0.13'

// Tema chiaro/scuro: salvato in localStorage, applicato come data-theme su
// <html> (le variabili CSS in styles.css fanno il resto).
type Theme = 'dark' | 'light'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('palamede-theme') as Theme) || 'dark' } catch { return 'dark' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('palamede-theme', theme) } catch { /* no storage */ }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

const NAV = [
  { path: '/', label: 'Officina', live: true },
  { path: '/images', label: 'Immagini', live: true },
  { path: '/chat', label: 'Chat', live: true },
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
  const { health, metrics, current, modelLabel, lastError } = useStore()
  const [sidebar, setSidebar] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : true)
  const [theme, toggleTheme] = useTheme()

  const gpuOk = metrics?.gpu.ok
  const loaded = current
  const shellCls = (sidebar ? 'shell shell-sidebar' : 'shell') + (route === '/chat' ? ' chat-shell' : '')

  return (
    <div className={shellCls}>
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
        <div className="beacon" role="status" aria-label="Stato dell'officina">
          <span className="led-row" title="Modello server attivo">
            <span className={`led ${health?.ok ? 'on' : 'off'}`} aria-hidden />
            {health?.ok ? 'officina accesa' : 'officina spenta'}
          </span>
          <span className="led-row" title="Modello caricato in VRAM">
            <span className="led on" aria-hidden />
            {loaded ? modelLabel(loaded) : 'VRAM vuota'}
          </span>
          <span className="led-row" title="Uso della GPU">
            <span className="log-bar" aria-hidden>
              <span className="log-fill" style={{ width: `${Math.min(100, gpuOk ? metrics!.gpu.utilPct : 0)}%` }} />
            </span>
            GPU {gpuOk ? `${Math.round(metrics!.gpu.utilPct)}%` : metrics ? 'n/d' : '…'}
          </span>
          <span className="led-row" title="CPU e RAM">
            CPU {metrics ? `${Math.round(metrics.cpu)}%` : '…'} · RAM {metrics ? `${metrics.ram.pct}%` : '…'}
            {lastError && <span className="hub-err" title={lastError}>⚠ {lastError}</span>}
          </span>
        </div>
        <button
          className="side-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          aria-pressed={theme === 'light'}
        >
          {theme === 'dark' ? '☀ chiaro' : '☾ scuro'}
        </button>
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
            ) : health === null ? (
              <div className="side-mini off">hub non raggiungibile — apri Palamede.exe</div>
            ) : metrics ? (
              <div className="side-mini off">nvidia-smi non disponibile</div>
            ) : (
              <div className="side-mini">lettura…</div>
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
                  <span title={p.name}>{p.name.split(/[\\/]/).pop()}</span>
                  <span
                    className={p.mem === '?' ? 'procs-mem na' : 'procs-mem'}
                    title={p.mem === '?' ? 'VRAM non riportata da nvidia-smi' : p.mem}
                  >
                    {p.mem === '?' ? '—' : p.mem}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      <main>{children}</main>
      <footer>
        <span>Palamede — officina locale · RTX 5060 Ti 16GB</span>
        <span>modello server :8000 · hub :4600 · <span className="build-tag">{BUILD}</span></span>
      </footer>
    </div>
  )
}