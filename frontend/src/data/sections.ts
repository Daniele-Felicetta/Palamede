// Unica fonte delle sezioni dell'officina: usata da Layout (nav) e Home (card).
export interface Section {
  path: string
  label: string
  glyph: string
  title: string
  text: string
  live: boolean
  foot: string
}

export const SECTIONS: Section[] = [
  { path: '/', label: 'Officina', glyph: 'OFI', title: 'Officina', text: 'Il banco di lavoro: stato modelli, metriche e registro di bordo.', live: true, foot: 'hub + registro di bordo' },
  { path: '/images', label: 'Immagini', glyph: 'IMG', title: 'Immagini', text: 'Due generatori: Bonsai 4B ternary (velocissimo) e Z-Image Turbo Q4 (qualità e testo nell\'immagine).', live: true, foot: '2 modelli installati · Bonsai + Z-Image' },
  { path: '/chat', label: 'Chat', glyph: 'CHT', title: 'Chat', text: 'Conversa con Ornith 1.5: 35B-A3B (MoE) e 9B, streaming locale con contesto e KV regolabili.', live: true, foot: '2 modelli ornith installati' },
  { path: '/3d', label: '3D', glyph: '3D', title: '3D', text: 'Genera asset 3D da una singola immagine: TRELLIS.2 produce mesh con texture PBR, esportate in GLB.', live: true, foot: 'TRELLIS.2 · da immagine' },
  { path: '/rag', label: 'RAG', glyph: 'RAG', title: 'RAG', text: 'Knowledge base llm-wiki: fonti grezze compilate dal modello in pagine interconnesse, usate come contesto nella chat.', live: true, foot: 'knowledge/ · compila con il modello chat' },
  { path: '/mcp', label: 'MCP', glyph: 'MCP', title: 'MCP', text: 'Gli strumenti dell\'officina esposti come server MCP per gli agenti.', live: false, foot: 'primo strumento al rilascio immagini' },
  { path: '/progetto', label: 'Progetto', glyph: 'PRJ', title: 'Progetto', text: 'La documentazione dell\'officina: mappa del progetto, README operativo e specifica tecnica, leggibili qui dentro.', live: true, foot: 'MAPPA.md · README · SPEC.md' },
  { path: '/experimental', label: 'Experimental', glyph: 'EXP', title: 'Experimental', text: 'Il registro delle prove: cosa abbiamo tentato, perché non è andata, e cosa stiamo provando adesso — con i rischi che restano.', live: true, foot: 'cronologia delle sperimentazioni' },
  { path: '/games', label: 'Giochi', glyph: 'GME', title: 'Giochi', text: 'Sezione giochi dell\'officina', live: true, foot: 'bozza · da definire' },
]
