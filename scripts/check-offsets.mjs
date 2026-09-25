// Check degli offset di chunkText (hub/lib/rag.mjs).
//
// Perché esiste: `start`/`end` dei chunk devono essere offset ESATTI nel file
// originale, altrimenti l'evidenziazione del passaggio citato nella fonte
// finisce fuori posto. Il bug classico è contare un separatore per riga quando
// il file usa i CRLF (2 caratteri): ogni chunk slitta di un carattere per ogni
// riga precedente. Eseguibile: `node scripts/check-offsets.mjs` (exit 1 se
// qualcosa non torna).
import { chunkText } from '../hub/lib/rag.mjs'

const norm = (s) => s.replace(/\s+/g, ' ').trim()

// Testo con paragrafi multipli, titoli e righe vuote. Ripetuto per superare la
// soglia dei chunk e mettere alla prova anche l'overlap fra chunk contigui.
const PARAS = [
  '# Titolo',
  'Prima riga del paragrafo.',
  'Seconda riga dello stesso paragrafo.',
  '',
  'Altro paragrafo, qui.',
  'E la sua seconda riga.',
  '',
  'Ultimo paragrafo con parole lunghe.',
  'Continuazione dell ultimo paragrafo.',
  '',
  'Paragrafo di riempimento per superare la soglia del chunk.',
  'Altra riga di riempimento con testo normale.',
  '',
]
const LONG = [...PARAS, ...PARAS, ...PARAS, ...PARAS]
const EOLS = { LF: '\n', CRLF: '\r\n', CR: '\r', MISTO: '\r\n\n' }

let failures = 0
for (const [name, eol] of Object.entries(EOLS)) {
  const text = LONG.join(eol)
  const chunks = chunkText(text)
  if (!chunks.length) {
    console.log(`${name}: nessun chunk, atteso almeno uno`)
    failures++
    continue
  }
  for (const c of chunks) {
    const raw = text.slice(c.start, c.end)
    if (norm(raw) !== norm(c.text)) {
      console.log(`${name}: OFFSET SBAGLIATI  raw=${JSON.stringify(raw)}  text=${JSON.stringify(c.text)}`)
      failures++
    }
    if (c.start < 0 || c.end > text.length || c.start >= c.end) {
      console.log(`${name}: limiti fuori testo (${c.start}, ${c.end}) su ${text.length}`)
      failures++
    }
  }
  // I chunk vanno in ordine di offset (l'overlap fra contigui e' voluto).
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].start < chunks[i - 1].start) {
      console.log(`${name}: chunk ${i} fuori ordine (${chunks[i].start} < ${chunks[i - 1].start})`)
      failures++
    }
  }
  console.log(`${name}: ${chunks.length} chunk, offset OK`)
}

if (failures) {
  console.error(`\n${failures} verifiche fallite`)
  process.exit(1)
}
console.log('\ncheck-offsets: tutto ok')
