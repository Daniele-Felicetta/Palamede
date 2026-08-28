// Mini renderer markdown per la chat: zero dipendenze (coerente col resto
// del progetto). Copre i blocchi più usati da Ornith: codice fenced,
// intestazioni, liste, tabelle, citazioni, hr, e inline (grassetto, corsivo,
// codice, link, barrato). Tutto l'HTML è escapato prima del rendering.

import { Fragment, ReactNode } from 'react'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g
const URL_RE = /(https?:\/\/[^\s<>"']+)/g

function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE_RE)
  const out: ReactNode[] = []
  let k = 0
  for (const p of parts) {
    if (!p) continue
    if (p.startsWith('`')) out.push(<code key={k++}>{esc(p.slice(1, -1))}</code>)
    else if (p.startsWith('**')) out.push(<strong key={k++}>{esc(p.slice(2, -2))}</strong>)
    else if (p.startsWith('__')) out.push(<strong key={k++}>{esc(p.slice(2, -2))}</strong>)
    else if (p.startsWith('~~')) out.push(<del key={k++}>{esc(p.slice(2, -2))}</del>)
    else if (p.startsWith('*')) out.push(<em key={k++}>{esc(p.slice(1, -1))}</em>)
    else if (p.startsWith('_')) out.push(<em key={k++}>{esc(p.slice(1, -1))}</em>)
    else if (p.startsWith('[')) {
      const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (m) out.push(<a key={k++} href={m[2]} target="_blank" rel="noreferrer">{esc(m[1])}</a>)
      else out.push(esc(p))
    }
    else {
      // testo semplice: autolink delle URL nude
      const seg = p.split(URL_RE)
      for (const s of seg) {
        if (!s) continue
        if (URL_RE.test(s)) out.push(<a key={k++} href={s} target="_blank" rel="noreferrer">{s}</a>)
        else out.push(esc(s))
      }
    }
  }
  return out
}

function isListLine(l: string): string | null {
  if (/^\s*[-*+]\s+/.test(l)) return 'ul'
  if (/^\s*\d+[.)]\s+/.test(l)) return 'ol'
  return null
}

function splitCells(l: string): string[] {
  return l.split('|').map((c) => c.trim()).filter((c, i, arr) => c !== '' || (i > 0 && i < arr.length - 1))
}

function isTableSep(l: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-')
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0

  while (i < lines.length) {
    const line = lines[i]

    // blocco codice fenced
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++ }
      i++ // salta la chiusura
      blocks.push(<pre key={k++}><code>{esc(buf.join('\n'))}</code></pre>)
      continue
    }

    // intestazioni (h3–h5: dentro una bolla h1/h2 sarebbero fuori scala)
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const lvl = Math.min(h[1].length + 2, 5)
      const Tag = `h${lvl}` as 'h3' | 'h4' | 'h5'
      blocks.push(<Tag key={k++}>{renderInline(h[2])}</Tag>)
      i++
      continue
    }

    // riga orizzontale
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { blocks.push(<hr key={k++} />); i++; continue }

    // citazione
    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].slice(1).trimStart()); i++ }
      blocks.push(<blockquote key={k++}>{renderInline(buf.join('\n'))}</blockquote>)
      continue
    }

    // tabella
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && !isTableSep(lines[i]) && !isListLine(lines[i]) && !lines[i].startsWith('#') && !lines[i].startsWith('```') && lines[i].trim() !== '') {
        rows.push(splitCells(lines[i]))
        i++
      }
      blocks.push(
        <table key={k++}>
          <thead><tr>{header.map((c, ci) => <th key={ci}>{renderInline(c)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{header.map((_, ci) => <td key={ci}>{renderInline(r[ci] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }

    // liste
    const listType = isListLine(line)
    if (listType) {
      const items: ReactNode[] = []
      while (i < lines.length) {
        const lt = isListLine(lines[i])
        if (!lt) break
        const m = lines[i].match(/^\s*(?:[-*+]+|\d+[.)])\s+(.*)$/)
        items.push(<li key={k++}>{renderInline(m ? m[1] : lines[i])}</li>)
        i++
      }
      blocks.push(listType === 'ul' ? <ul key={k++}>{items}</ul> : <ol key={k++}>{items}</ol>)
      continue
    }

    // paragrafo
    if (line.trim() !== '') {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !isListLine(lines[i]) && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('>') && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        buf.push(lines[i]); i++
      }
      blocks.push(<p key={k++}>{renderInline(buf.join('\n'))}</p>)
      continue
    }

    i++ // riga vuota
  }

  return <div className="md">{blocks.map((b, bi) => <Fragment key={bi}>{b}</Fragment>)}</div>
}