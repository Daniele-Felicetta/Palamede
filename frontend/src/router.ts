// Router hash-based: niente dipendenze. Le route sono già "sicure" per file
// statici serviti dal hub (nessun rewrite server-side richiesto).
import { useEffect, useState } from 'react'

export function useHashRoute(): [string, (to: string) => void] {
  const read = () => (location.hash.replace(/^#/, '') || '/')
  const [path, setPath] = useState(read)
  useEffect(() => {
    const on = () => setPath(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = (to: string) => { location.hash = to }
  return [path, navigate]
}
