import { ReactNode, useEffect, useState } from 'react'
import { getHealth, Health } from '../api'
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

function Led({ ok }: { ok: boolean | undefined }) {
  const cls = ok === undefined ? 'off' : ok ? 'on' : 'off'
  return <span className={`led ${cls}`} aria-hidden />
}

export function Layout({ children }: { children: ReactNode }) {
  const [route, navigate] = useHashRoute()
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try { setHealth(await getHealth()) } catch { setHealth(null) }
    }
    tick()
    const id = setInterval(tick, 4000)
    return () => { stop = true; clearInterval(id); void stop }
  }, [])

  return (
    <>
      <header className="masthead">
        <a
          className="brand"
          href="#/"
          onClick={(e) => { e.preventDefault(); navigate('/') }}
        >
          <span className="seal">P</span>
          Palamede
        </a>
        <nav className="nav" aria-label="Sezioni">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={'#' + n.path}
              className={
                (route === n.path ? 'active ' : '') + (n.live ? '' : 'disabled')
              }
              onClick={(e) => { e.preventDefault(); navigate(n.path) }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="beacon" title="Backend locali (verde = pronto, spento = spento)">
          <span className="led-row"><Led ok={health?.bonsai?.ok} />B</span>
          <span className="led-row"><Led ok={health?.zimage?.ok} />Z</span>
        </div>
      </header>
      <main>{children}</main>
      <footer>
        <span>Palamede — officina locale · RTX 5060 Ti 16GB</span>
        <span>bonsai :8000 · z-image :8123 · hub :4600</span>
      </footer>
    </>
  )
}
