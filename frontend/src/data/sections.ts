// Unica fonte delle sezioni dell'officina: usata da Layout (nav) e Home (card).
export interface Section {
  path: string
  label: string
  glyph: string
  icon: string
  title: string
  text: string
  live: boolean
  foot: string
}

export const SECTIONS: Section[] = [
  { path: '/', label: 'Officina', glyph: 'OFI', icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', title: 'Officina', text: 'Il banco di lavoro: stato modelli, metriche e registro di bordo.', live: true, foot: 'hub + registro di bordo' },
  { path: '/images', label: 'Immagini', glyph: 'IMG', icon: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>', title: 'Immagini', text: 'Quattro generatori: Bonsai 4B ternary (velocissimo), Z-Image Turbo Q4, Klein 4B (img2img) e Qwen-Image 2.1 (7B, testo ed editing).', live: true, foot: '4 modelli · Bonsai · Z-Image · Klein · Qwen-Image' },
  { path: '/chat', label: 'Chat', glyph: 'CHT', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', title: 'Chat', text: 'Conversa con Ornith 1.5: 35B-A3B (MoE) e 9B, streaming locale con contesto e KV regolabili.', live: true, foot: '2 modelli ornith installati' },
  { path: '/3d', label: '3D', glyph: '3D', icon: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>', title: '3D', text: 'Genera asset 3D da una singola immagine: TRELLIS.2 produce mesh con texture PBR, esportate in GLB.', live: true, foot: 'TRELLIS.2 · da immagine' },
  { path: '/rag', label: 'RAG', glyph: 'RAG', icon: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>', title: 'RAG', text: 'Knowledge base llm-wiki: fonti grezze compilate dal modello in pagine interconnesse, usate come contesto nella chat.', live: true, foot: 'knowledge/ · compila con il modello chat' },
  { path: '/mcp', label: 'MCP', glyph: 'MCP', icon: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>', title: 'MCP', text: 'Gli strumenti dell\'officina esposti come server MCP per gli agenti.', live: false, foot: 'primo strumento al rilascio immagini' },
  { path: '/progetto', label: 'Progetto', glyph: 'PRJ', icon: '<path d="M20 7h-9l-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/>', title: 'Progetto', text: 'La documentazione dell\'officina: mappa del progetto, README operativo e specifica tecnica, leggibili qui dentro.', live: true, foot: 'MAPPA.md · README · SPEC.md' },
  { path: '/experimental', label: 'Experimental', glyph: 'EXP', icon: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>', title: 'Experimental', text: 'Il registro delle prove: cosa abbiamo tentato, perché non è andata, e cosa stiamo provando adesso — con i rischi che restano.', live: true, foot: 'cronologia delle sperimentazioni' },
  { path: '/games', label: 'Giochi', glyph: 'GME', icon: '<path d="M6 11h4"/><path d="M8 9v4"/><path d="M15 12h.01"/><path d="M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>', title: 'Giochi', text: 'Sezione giochi dell\'officina', live: true, foot: 'bozza · da definire' },
]
