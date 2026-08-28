import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Images } from './pages/Images'
import { Draft } from './pages/Draft'
import { DRAFTS } from './data/wiki'
import { useHashRoute } from './router'
import './styles.css'

function Page({ path }: { path: string }) {
  if (path === '/' ) return <Home />
  if (path === '/images') return <Images />
  const d = DRAFTS.find((x) => x.path === path)
  if (d) return <Draft draft={d} />
  return <Home />
}

function App() {
  const [path] = useHashRoute()
  return (
    <Layout>
      <Page path={path} />
    </Layout>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
