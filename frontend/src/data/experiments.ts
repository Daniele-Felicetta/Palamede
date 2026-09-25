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
    why: 'Pesi scaricati in models/_inutilizzati/, mai collegati all\'hub: il vincolo un-modello-alla-volta sulla GPU e i text-encoder pesanti (UMT5, VAE video) li rendono fuori scala. Per Wan esiste un server standalone non cablato (backends/wan_server.py, :8126), prova isolata mai esposta nella UI.',
    paths: ['backends/wan_server.py', 'models/_inutilizzati/wan2.1-1.3b/', 'models/_inutilizzati/ltx-2.5/', 'models/_inutilizzati/animatediff/'],
  },
  {
    id: '3d',
    period: 'ago 2026 → set 2026',
    status: 'sostituito',
    title: '3D — ComfyUI e Hunyuan3D',
    what: 'Generatori di mesh da testo/immagine (Hunyuan3D di Tencent) via ComfyUI headless, con viewer glTF in pagina.',
    why: 'Non è fallito: è stato superato. Al posto di ComfyUI+Hunyuan3D è entrato TRELLIS.2 di Microsoft, integrato a mano (backends/trellis_server.py, :8124) e operativo nella pagina /3d: niente motore ComfyUI da portarsi dietro.',
    paths: ['backends/trellis_server.py', 'frontend/src/pages/3d.svelte', 'SPEC.md'],
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
  {
    id: 'rag-keyword',
    period: 'set 2026',
    status: 'sostituito',
    title: 'RAG per keyword (LLM Wiki)',
    what: 'Prima versione della knowledge base: ricerca per keyword sui file di knowledge/, pattern "LLM Wiki" di Karpathy, zero dipendenze.',
    why: 'Superata dal RAG vettoriale in stile NotebookLM: chunk + embedding (embeddinggemma su Ollama), retrieval ibrido coseno+BM25 e rerank MiniCPM. La ricerca per keyword sopravvive solo come fallback quando Ollama o il reranker sono giù.',
    paths: ['hub/lib/rag.mjs', 'knowledge/'],
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
]
