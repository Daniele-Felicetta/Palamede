// Contenuti wiki: tutti i numeri sono MISURATI su RTX 5060 Ti 16GB,
// GPU dedicata (un modello alla volta), seed diversi per run.

export interface Example {
  file: string
  prompt: string
  note: string
}

export interface ModelWiki {
  id: string
  name: string
  family: string
  how: string[]
  specs: Record<string, string>
  quality: string[]
  examples: Example[]
}

export const BONSAI: ModelWiki = {
  id: 'bonsai',
  name: 'Bonsai 4B — Ternary',
  family: 'PrismML · FLUX.2-klein',
  how: [
    'Bonsai è la versione ultracompressa di un transformer di diffusione FLUX.2-klein da 4 miliardi di parametri: i pesi del transformer vengono quantizzati a 1.58 bit (ternario: −1, 0, +1) con i kernel Triton di gemlite, mentre il text encoder Qwen3 resta a 4 bit (HQQ) e il VAE è quello di Flux2 in bf16.',
    'La generazione richiede solo 4 step di diffusione: la distillazione è già nei pesi ternari. Sul percorso GPU (Linux/Windows) tutto gira in fp16: i pesi ternari vengono "decompressed on-the-fly" dentro i kernel GEMM di gemlite, quindi la qualità paga la compressione ma la velocità resta quella di una GPU consumer.',
    'Nota da officina: la prima immagine a una nuova risoluzione paga 10–30 s di JIT Triton/autotune, poi la cache in outputs/.triton_cache rende i tempi stabili.',
  ],
  specs: {
    'Parametri': '4B (FLUX.2-klein) a 1.58 bit',
    'Peso disco': '4.2 GB totali (DiT int2 1.44 + text encoder HQQ-4bit 2.64 + VAE 0.16)',
    'VRAM misurata': '≈ 6 GB residente a 512²–1024²',
    'Tempo 512²': '1.8 s warm (4.0 s primo colpo)',
    'Tempo 1024²': '6.4 s warm (19.4 s primo colpo)',
    'Tempo 1248×832': '≈ 10.4 s warm',
    'Step': '4 (consigliati)',
    'CFG': 'non esposto (modello distillato)',
    'Rispezioni': 'multipli di 32, 256–2048; preset: 512², 1024², 640×416, 1248×832, 416×640, 1408×704, 704×1408',
    'Endpoint': 'POST http://127.0.0.1:8000/generate (backend: bonsai-ternary-gemlite)',
  },
  quality: [
    'Molto buono per scene naturali, oggetti e still life: pelliccia, legno, muschio e sfondi a fuoco/bokeh escono credibili a 512².',
    'A 1024² tiene la coerenza senza artefatti, con un passo qualità evidente sui dettagli fini (foglie, corteccia).',
    'Peggio su testo nell\'immagine e scene affollate; è il modello "leggero" della coppia: vince per velocità assoluta.',
  ],
  examples: [
    { file: 'bonsai-icy-tree.png', prompt: 'An icy bonsai tree, in a rainy forest with a snowy mountain in the background, photo realistic', note: '512² · 1.9 s' },
    { file: 'bonsai-terrace.png', prompt: 'A bonsai tree growing in a cracked ceramic pot on a sunlit windowsill, shallow depth of field', note: '512² · 1.8 s' },
    { file: 'bonsai-pine-autumn.png', prompt: 'Bonsai pine in autumn colors against misty mountains, golden hour, photo realistic', note: '1248×832 · 10.4 s' },
    { file: 'bonsai-studio.png', prompt: 'A tiny bonsai tree on a wooden table, studio photo, clean background', note: '1024² · 6.3 s' },
  ],
}

export const ZIMAGE: ModelWiki = {
  id: 'zimage',
  name: 'Z-Image Turbo — Q4_K_M',
  family: 'Tongyi Lab · S3-DiT',
  how: [
    'Z-Image è un transformer di diffusione SINGLE-STREAM da 6B: token di testo, semantica visiva e latenti VAE entrano Concatenati in un\'unica sequenza (S3-DiT), invece che in due rami separati come CLIP/Flux. L\'accelerazione viene da Decoupled-DMD + DMDR: una distillazione a pochi step che spinge la "CFG augmentation" a motore e lascia il distribution matching da regolare.',
    'La variante Turbo è pensata per uscire in 8 step senza classifier-free guidance (cfg_scale=1.0, effettivo 0): i due pesi del prompt non vengono nemmeno calcolati. Il file GGUF Q4_K_M gira qui dentro stable-diffusion.cpp, con Qwen3-4B (GGUF) come text encoder e un VAE Flux-style — tutto resident in VRAM.',
    'È bilingue EN/ZH e sa renderizzare testo nell\'immagine con precisione tipografica: è la specialità dichiarata del modello.',
  ],
  specs: {
    'Parametri': '6B (S3-DiT single-stream), quantizzato Q4_K_M',
    'Peso disco': '7.2 GB totali (DiT 4.67 + Qwen3-4B TE 2.33 + VAE 0.16)',
    'VRAM misurata': '≈ 8.5 GB residente (sd-server, tutto su GPU)',
    'Tempo 512²': '3.3 s warm (5.6 s primo colpo)',
    'Tempo 1024²': '17.8 s warm',
    'Tempo 1248×832': '≈ 16.6 s warm',
    'Step': '8 (distillato)',
    'CFG': '1.0 — alzarlo degrada',
    'Rispezioni': 'consigliato 1024² nativo; supportato fino a ~1408×704',
    'Endpoint': 'POST http://127.0.0.1:8123/sdapi/v1/txt2img (sd-server)',
  },
  quality: [
    'Photorealismo forte: luce, materiali e profondità di campo credibili già a 512², eccellente a 1024² (il suo terreno di casa).',
    'Rendering testo nell\'immagine da primato tra gli open source: "FRESH COFFEE" nell\'esempio è a fuoco e corretto al primo colpo.',
    'Aderenza al prompt e scene complesse superiori a Bonsai; paga in velocità (~3×) e VRAM (~2.5 GB in più).',
  ],
  examples: [
    { file: 'zimage-fox.png', prompt: 'A red fox sitting on a mossy rock in a misty forest, photorealistic, soft morning light', note: '512² · 5.7 s' },
    { file: 'zimage-hanfu.png', prompt: 'Young Chinese woman in red Hanfu, intricate embroidery, golden phoenix headdress, neon lantern glow, night background with tiered pagoda', note: '1024² · 16.7 s' },
    { file: 'zimage-coffee.png', prompt: 'A cozy coffee shop storefront at dusk with a large hand-written wooden sign that reads FRESH COFFEE, warm interior glow, wet pavement reflections', note: '1024² · 16.6 s — nota il testo' },
    { file: 'zimage-city.png', prompt: 'A cinematic night cityscape with neon signs and street reflections after rain, ultra detailed, 8K', note: '1248×832 · 16.2 s' },
  ],
}

export const IMAGE_MODELS = [BONSAI, ZIMAGE]

// ── Wiki delle sezioni "bozza" ────────────────────────────────────────────

export interface DraftWiki {
  path: string
  title: string
  glyph: string
  tagline: string
  how: string[]
  specs: Record<string, string>
  needs: string[]
}

export const DRAFTS: DraftWiki[] = [
  {
    path: '/text',
    title: 'Testo',
    glyph: 'TXT',
    tagline: 'Chat e completamento con LLM locali (Ollama / llama.cpp già presenti sulla macchina).',
    how: [
      'I modelli linguistici locali girano come server OpenAI-compatibili: llama.cpp llama-server espone /v1/chat/completions con sampling, context e function calling; Ollama è un pacchetto simile già installato su questa macchina.',
      'Nel hub la pagina Testo diventerà un terminale a schede: selezione modello (GGUF o Ollama), parametri di campionamento, streaming dei token, cronologia chat. L\'integrazione MCP e il RAG si appoggeranno allo stesso server.',
    ],
    specs: {
      'Engine previsto': 'llama.cpp llama-server (GGUF) + Ollama',
      'Modelli': 'GGUF da models/ (es. Qwen3, DeepSeek) — nessuno installato',
      'VRAM': 'da 1 GB (0.8B) a 14 GB (70B Q2)',
      'Latenza': '0.1 s prefill + 10–80 tok/s decode (GPU)',
      'Stato': 'bozza — nessun modello testo installato',
    },
    needs: [
      'Scaricare 1–2 GGUF instruct (es. Qwen3-4B e un MoE più grande) in models/',
      'Script start-text.ps1 che avvia llama-server --embedding (serve anche al RAG)',
      'Pagina chat con streaming SSE',
    ],
  },
  {
    path: '/video',
    title: 'Video',
    glyph: 'VID',
    tagline: 'Text-to-video locale (Wan 2.x) — stesso engine sd.cpp che ospita già Z-Image.',
    how: [
      'stable-diffusion.cpp espone già l\'endpoint asincrono /sdcpp/v1/vid_gen per i modelli video (Wan 2.1/2.2 e LTX): job in coda, polling dello stato e container webm di ritorno.',
      'I modelli video richiedano però ben più VRAM dell\'image stack (Wan 14B parte da ~12 GB con offload): la pagina nascerà come job-queue con preview dei frame, quando avremo i pesi in models/.',
    ],
    specs: {
      'Engine previsto': 'sd-server /sdcpp/v1/vid_gen (già scaricato in tools/)',
      'Modelli': 'Wan 2.1/2.2, LTX-Video — nessuno installato',
      'VRAM': '≥ 12 GB realistiche (16 GB comodi)',
      'Latenza': 'minuti per clip da 4–8 s',
      'Stato': 'bozza — nessun modello video installato',
    },
    needs: [
      'Pesare un modello Wan (es. 1.3B) e un VAE video in models/',
      'Polling del job + galleria webm nella UI',
    ],
  },
  {
    path: '/3d',
    title: '3D',
    glyph: '3D',
    tagline: 'Mesh e GS dalla descrizione: TRELLIS e Hunyuan3D.',
    how: [
      'I generatori 3D moderni (TRELLIS di Microsoft, Hunyuan3D di Tencent) sono pipeline diffusion che producono latenti voxel/occupancy e li decodificano in mesh con PBR, oppure Gaussian Splatting. Girano via ComfyUI o custom nodes; l\'integrazione più semplice è un workflow ComfyUI headless dietro API.',
      'La pagina mostrerà l\'anteprima del textured mesh (viewer three.js) con download glTF.',
    ],
    specs: {
      'Engine previsto': 'ComfyUI headless + custom node TRELLIS/Hunyuan3D',
      'Modelli': 'TRELLIS-image-large, Hunyuan3D-2 — nessuno installato',
      'VRAM': '8–16 GB',
      'Latenza': '1–5 min per asset',
      'Stato': 'bozza — motore e modelli non installati',
    },
    needs: ['ComfyUI in tools/ + workflow .json preconfigurati', 'viewer glTF nella UI'],
  },
  {
    path: '/rag',
    title: 'RAG',
    glyph: 'RAG',
    tagline: 'Interrogazione di documenti privati: embeddings + vector store + LLM locale.',
    how: [
      'Tutto resta locale: llama.cpp llama-server --embedding (o Ollama) calcola gli embedding, sqlite-vec/Chroma memorizza gli indici nella cartella index/ (ignorata), e un server-side retriever monta il contesto nella chat del modello.',
      'Interfaccia: upload cartelle, barra di query, citazioni delle fonti con snippet. Il backend richiama le API della pagina Testo e della stessa coda mutex GPU.',
    ],
    specs: {
      'Engine previsto': 'llama-server --embedding + sqlite-vec',
      'Modelli': 'embedding (bge-m3, qwen3-embedding) — nessuno installato',
      'VRAM': 'poche centinaia di MB per 0.5–1B di embedding',
      'Latenza': '~ms per query; indicizzazione lineare',
      'Stato': 'bozza — serve un modello embeddings',
    },
    needs: ['Modello embeddings GGUF in models/', 'CLI di ingestimento documenti'],
  },
  {
    path: '/mcp',
    title: 'MCP',
    glyph: 'MCP',
    tagline: 'Server Model Context Protocol per far usare gli strumenti dell\'officina agli agenti.',
    how: [
      'Palamede espone se stessa come server MCP stdio: strumenti palamede.generate_image(model, prompt, size, seed) e (quando attivo) text/video/rag. Gli agenti (opencode, Claude, ecc.) la configurano in mcpServers e generano con i modelli locali senza parlare con provider esterni.',
      'llama.cpp ha già il lato client (--mcp-servers-config); il nostro ruolo è il lato server: wrapper JSON-RPC sul /api del hub.',
    ],
    specs: {
      'Transport': 'stdio JSON-RPC (spec 2025-06)',
      'Strumenti': 'image.generate attivo dal primo commit; text/video/rag al rilascio delle sezioni',
      'Dipendenze': 'nessuna lato agent (client MCP standard)',
      'Stato': 'bozza — implementazione prevista',
    },
    needs: ['mcp/server.mjs che inviluppa POST /api/image come tool MCP'],
  },
]
