// Unica fonte della sezione Experimental: cronologia delle prove accantonate/
// sospese e dei lavori in corso. Aggiornare qui per far parlare la pagina.

export type TriedStatus = 'accantonato' | 'sospeso' | 'bozza' | 'sostituito'

export interface TriedItem {
  id: string
  period: string
  status: TriedStatus
  title: string
  what: string
  why: string
  paths: string[]
}

export interface WipItem {
  id: string
  period: string
  title: string
  what: string
  fixes: string[]
  risks: string[]
  paths: string[]
}

// Cronologia delle prove (dalla più vecchia alla più recente).
export const TRIED: TriedItem[] = [
  {
    id: 'launcher-net',
    period: '28 ago',
    status: 'sostituito',
    title: 'Launcher .NET (WinForms)',
    what: 'Primo launcher desktop in C# compilato con csc, che avviava i servizi e apriva la UI nel browser: ~12 KB, senza runtime da installare.',
    why: 'Non è fallito: è stato superato. L\'architettura v2 è un\'app nativa Tauri (Rust) che incastra hub, backends e UI in una finestra propria con tray e Job Object. Il flusso .NET è archiviato in legacy/.',
    paths: ['legacy/launcher/PalamedeLauncher.cs', 'legacy/scripts/build-launcher.ps1'],
  },
  {
    id: 'klein-9b',
    period: '29 ago',
    status: 'accantonato',
    title: 'FLUX.2-klein 9B (NVFP4 → BF16 → GGUF)',
    what: 'Tentativo di portare la variante 9B oltre al 4B attivo: il download originale usa la quantizzazione NVFP4 di BFL/ModelOpt, che sd.cpp non legge.',
    why: 'sd.cpp non supporta NVFP4: convertito in BF16 (18 GB, troppo pesante) e provato anche in GGUF Q4_0, mai integrato come modello selezionabile. Resta in models/_inutilizzati/klein-9b/.',
    paths: ['scripts/convert-nvfp4-bf16.py', 'models/_inutilizzati/klein-9b/'],
  },
  {
    id: 'video',
    period: 'ago 2026',
    status: 'sospeso',
    title: 'Video — Wan 2.1, LTX 2.5, Animatediff',
    what: 'Tre strade per la generazione video: Wan 2.1 T2V 1.3B (con encoder UMT5-XXL), pipeline LTX 2.5 (VAE + upscaler), Animatediff Lightning 4-step.',
    why: 'Pesi scaricati in models/_inutilizzati/, mai collegati a un backend: il vincolo un-modello-alla-volta sulla GPU e i text-encoder pesanti (UMT5, VAE video) li rendono fuori scala per l\'hub. Nessun commit li tocca.',
    paths: ['models/_inutilizzati/wan2.1-1.3b/', 'models/_inutilizzati/ltx-2.5/', 'models/_inutilizzati/animatediff/'],
  },
  {
    id: '3d',
    period: 'ago 2026',
    status: 'bozza',
    title: '3D — TRELLIS e Hunyuan3D',
    what: 'Generatori di mesh da testo/immagine (TRELLIS di Microsoft, Hunyuan3D di Tencent) via ComfyUI headless, con viewer glTF in pagina.',
    why: 'Mai avviato: motore ComfyUI e modelli non installati. Vive solo la wiki della sezione, in attesa di decidere se e quando portarli dentro.',
    paths: ['frontend/src/data/wiki.ts', 'SPEC.md'],
  },
  {
    id: 'mcp',
    period: 'ago 2026',
    status: 'bozza',
    title: 'MCP — server per gli agenti',
    what: 'Esporre l\'officina come server Model Context Protocol stdio: wrapper JSON-RPC su /api/image, così gli agenti generano con i modelli locali.',
    why: 'Mai scritto: manca mcp/server.mjs. La wiki c\'è, il codice no. Fermo finché le sezioni non hanno una forma stabile da esporre.',
    paths: ['frontend/src/data/wiki.ts', 'SPEC.md'],
  },
]

// In prova adesso: cosa manca da sistemare e perché potrebbe non andare.
export const WIP: WipItem[] = [
  {
    id: 'model-antivirus',
    period: '30 ago →',
    title: 'Model-antivirus',
    what: 'Scanner d\'integrità dei pesi: all\'avvio verifica rapida (esistenza, dimensione, formato) — lo SHA-256 è saltato perché lento con decine di GB; al download o a mano, audit di affidabilità con l\'LLM locale. Integrato nel launcher e in copy-models.ps1.',
    fixes: [
      'All\'avvio si fa solo lo scan deterministico rapido: valutare lo scan completo (SHA-256) a intervalli o a richiesta.',
      'Se il giudice LLM non è raggiungibile (exit 3) non si produce un verdetto: il fallback a keyword c\'è ma è debole.',
      'Lo scan dei .pt guarda solo i nomi dei file dentro lo zip: decomprimere gigabyte è troppo lento, così i pattern nel contenuto sfuggono.',
      'llama-server non supporta response_format: l\'audit riprova senza JSON schema (HTTP 400).',
    ],
    risks: [
      'Non rileva backdoor comportamentali nei pesi (es. attivatori latenti): valuta struttura, opcode, metadata e provenienza, non i byte.',
      'Il verdetto è un\'euristica del giudice locale, non una garanzia: restano falsi positivi e negativi.',
    ],
    paths: ['experimental/model-antivirus/', 'src-tauri/src/main.rs', 'scripts/copy-models.ps1'],
  },
  {
    id: 'rag-vettoriale',
    period: 'futuro',
    title: 'RAG vettoriale — embeddinggemma',
    what: 'Oggi la knowledge base cerca per keyword (pattern LLM Wiki di Karpathy, zero dipendenze). embeddinggemma è già installato su Ollama per l\'upgrade al vettoriale.',
    fixes: [
      'Integrare /api/embed di Ollama e uno storage vettoriale (oggi la ricerca è keyword).',
      'Decidere quando scattare: SPEC lo rimanda a quando la wiki supera le centinaia di pagine.',
    ],
    risks: [
      'embeddinggemma su Ollama condivide la VRAM con il modello attivo: può rompere il vincolo un-modello-alla-volta.',
      'Aggiunge una dipendenza (Ollama): se non è su, la ricerca vettoriale cade; la keyword oggi funziona sempre.',
    ],
    paths: ['SPEC.md', 'hub/server.mjs'],
  },
]
