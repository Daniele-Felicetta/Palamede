<script lang="ts">
  // Mini renderer markdown per la chat: zero dipendenze (coerente col resto
  // del progetto). Copre i blocchi più usati da Ornith: codice fenced,
  // intestazioni, liste, tabelle, citazioni, hr, e inline (grassetto, corsivo,
  // codice, link, barrato). Tutto l'HTML è escapato PRIMA di essere iniettato
  // con {@html}, quindi il rendering resta sicuro esattamente come l'originale
  // React che costruiva elementi.
  let { text }: { text: string } = $props()

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // Solo http/https (e ancore/relative): niente javascript:/data:/vbscript:
  // che con {@html} diventerebbero XSS nella webview Tauri.
  function safeHref(url: string): string | null {
    const u = url.trim()
    if (/^(https?:\/\/|#|\/)/i.test(u) && !/^[\s]*javascript:/i.test(u) && !/^data:/i.test(u) && !/^vbscript:/i.test(u)) {
      return esc(u)
    }
    return null
  }

  const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g
  const URL_RE = /(https?:\/\/[^\s<>"']+)/g
  // NOTA: URL_TEST è senza flag 'g' — con 'g' .test() è stateful (lastIndex
  // avanza tra le chiamate) e gli autolink delle URL nude alternerebbero
  // in modo casuale. Il 'g' serve solo allo split (URL_RE sopra).
  const URL_TEST = /^https?:\/\/[^\s<>"']+$/

  function renderInline(text: string): string {
    return text.split(INLINE_RE).map((p) => {
      if (!p) return ''
      if (p.startsWith('`')) return `<code>${esc(p.slice(1, -1))}</code>`
      if (p.startsWith('**')) return `<strong>${esc(p.slice(2, -2))}</strong>`
      if (p.startsWith('__')) return `<strong>${esc(p.slice(2, -2))}</strong>`
      if (p.startsWith('~~')) return `<del>${esc(p.slice(2, -2))}</del>`
      if (p.startsWith('*')) return `<em>${esc(p.slice(1, -1))}</em>`
      if (p.startsWith('_')) return `<em>${esc(p.slice(1, -1))}</em>`
      if (p.startsWith('[')) {
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (m) {
          const href = safeHref(m[2])
          if (href) return `<a href="${href}" target="_blank" rel="noreferrer">${esc(m[1])}</a>`
          return esc(p)
        }
        return esc(p)
      }
      // testo semplice: autolink delle URL nude
      return p.split(URL_RE).map((s) => {
        if (!s) return ''
        if (URL_TEST.test(s)) {
          const href = safeHref(s)
          if (href) return `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`
        }
        return esc(s)
      }).join('')
    }).join('')
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

  function render(text: string): string {
    const lines = text.split(/\r?\n/)
    const out: string[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // blocco codice fenced
      const fence = line.match(/^```(\w*)\s*$/)
      if (fence) {
        const buf: string[] = []
        i++
        while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++ }
        i++ // salta la chiusura
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
        continue
      }

      // intestazioni (h3–h5: dentro una bolla h1/h2 sarebbero fuori scala)
      const h = line.match(/^(#{1,4})\s+(.*)$/)
      if (h) {
        const lvl = Math.min(h[1].length + 2, 5)
        out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`)
        i++
        continue
      }

      // riga orizzontale
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue }

      // citazione
      if (line.startsWith('>')) {
        const buf: string[] = []
        while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].slice(1).trimStart()); i++ }
        out.push(`<blockquote>${renderInline(buf.join('\n'))}</blockquote>`)
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
        let t = '<table><thead><tr>'
        for (const c of header) t += `<th>${renderInline(c)}</th>`
        t += '</tr></thead><tbody>'
        for (const r of rows) {
          t += '<tr>'
          header.forEach((_, ci) => { t += `<td>${renderInline(r[ci] ?? '')}</td>` })
          t += '</tr>'
        }
        t += '</tbody></table>'
        out.push(t)
        continue
      }

      // liste
      const listType = isListLine(line)
      if (listType) {
        const items: string[] = []
        while (i < lines.length) {
          const lt = isListLine(lines[i])
          if (!lt) break
          const m = lines[i].match(/^\s*(?:[-*+]+|\d+[.)])\s+(.*)$/)
          items.push(`<li>${renderInline(m ? m[1] : lines[i])}</li>`)
          i++
        }
        out.push(listType === 'ul' ? `<ul>${items.join('')}</ul>` : `<ol>${items.join('')}</ol>`)
        continue
      }

      // paragrafo
      if (line.trim() !== '') {
        const buf: string[] = []
        while (i < lines.length && lines[i].trim() !== '' && !isListLine(lines[i]) && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('>') && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
          buf.push(lines[i]); i++
        }
        out.push(`<p>${renderInline(buf.join('\n'))}</p>`)
        continue
      }

      i++ // riga vuota
    }

    return out.join('')
  }
</script>

<div class="md">{@html render(text)}</div>