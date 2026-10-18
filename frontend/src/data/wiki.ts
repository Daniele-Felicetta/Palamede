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
    'Tempo 512²': '1.8 s warm (20 s il primo colpo: JIT Triton)',
    'Tempo 1024²': '6.3 s warm (7.3 s il primo colpo)',
    'Tempo 1248×832': '≈ 10.4 s warm',
    'Step': '4 (consigliati)',
    'CFG': 'non esposto (modello distillato)',
    'Risoluzioni': 'multipli di 32, 256–2048; preset: 512², 768², 896², 1024², 640×416, 768×512, 1248×832, 416×640, 512×768, 832×1248',
    'Endpoint': 'POST /api/image (hub —> :8000/generate, backend bonsai-ternary-gemlite)',
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
    'La variante Turbo è pensata per uscire in 8 step senza classifier-free guidance (cfg_scale=1.0, effettivo 0): i due pesi del prompt non vengono nemmeno calcolati. Il file GGUF Q4_K_M gira qui dentro stable-diffusion.cpp, con Qwen3-4B (GGUF) come text encoder e un VAE Flux-style — tutto residente in VRAM.',
    'È bilingue EN/ZH e sa renderizzare testo nell\'immagine con precisione tipografica: è la specialità dichiarata del modello.',
  ],
  specs: {
    'Parametri': '6B (S3-DiT single-stream), quantizzato Q4_K_M',
    'Peso disco': '7.2 GB totali (DiT 4.67 + Qwen3-4B TE 2.33 + VAE 0.16)',
    'VRAM misurata': '≈ 5 GB residente (TE da 3.5 GB su RAM via --backend te=cpu; tutto su GPU: ≈ 8.5 GB)',
    'Tempo 512²': '3.8 s warm (8.5 s il primo colpo)',
    'Tempo 1024²': '17.6 s warm',
    'Tempo 1248×832': '≈ 16.6 s warm',
    'Step': '8 (distillato)',
    'CFG': '1.0 — alzarlo degrada',
    'Risoluzioni': 'consigliato 1024² nativo; multipli di 32 fino a 1248×832',
    'Endpoint': 'POST /api/image (hub —> :8000/generate, backend sd-server)',
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

export const KLEIN: ModelWiki = {
  id: 'klein',
  name: 'Klein 4B — Q4',
  family: 'FLUX.2-klein · GGUF',
  how: [
    'La versione GGUF Q4 del transformer FLUX.2-klein da 4B (lo stesso dietro Bonsai): gira in stable-diffusion.cpp come modello standalone, con la VAE FLUX.2 di reference/bonsai e il text encoder Qwen3-4B in GGUF.',
    'È il modello scelto per l\'image-to-image: nell\'API sd.cpp l\'img2img è nativo (init image + denoising strength), quindi da questa pagina puoi caricare un\'immagine, regolare quanto deve cambiare (forza) e riformularla.',
    'I pesi Q4_K_M (2,5 GB) sono installati in models/: girano in sd-server con la VAE FLUX.2 di reference/bonsai e il text encoder Qwen3-4B.',
  ],
  specs: {
    'Parametri': '4B (FLUX.2-klein) quantizzato Q4_K_M',
    'Peso disco': '2.5 GB (GGUF)',
    'VRAM misurata': '≈ 6.2 GB in sd-server (TE 3.5 + DiT 2.5 + VAE 0.16)',
    'Text encoder': 'Qwen3-4B (GGUF) — riusato da Z-Image',
    'VAE': 'FLUX.2 (da reference/bonsai)',
    'Tempo 512²': '≈ 5.4 s txt2img · ≈ 1.8 s img2img (4 step)',
    'Step': '4–8 (distillato)',
    'CFG': '1.0',
    'Endpoint': 'POST /api/image con "image" + "strength" (img2img)',
  },
  quality: [
    'Qualità di famiglia FLUX.2-klein: scenari naturali e composizione solida già a pochi step.',
    'Per img2img: leva il denoise per ritocchi lievi (0.3–0.5), alzalo per re-immaginare la scena (0.7–0.9).',
  ],
  examples: [],
}

export const QWENIMAGE: ModelWiki = {
  id: 'qwenimage',
  name: 'Qwen-Image 2.1 — Q4_K_M',
  family: 'Qwen (Alibaba) · Single-Stream DiT 7B',
  how: [
    'Qwen-Image 2.1 è il modello unificato di generazione ed editing di Qwen: 7B nel componente visivo (32 layer DiT single-stream) con attenzione a granularità mista e riuso della KV cache di prefisso. È bilingue EN/ZH.',
    'Il GGUF Q4_K_M (unsloth Dynamic 2.0) è solo il denoiser: servono il text encoder Qwen3-VL-8B in GGUF e la VAE dedicata. Gira in stable-diffusion.cpp come Z-Image e Klein, ma con cfg reale (6.0, sampler euler, 40 step) perché NON è un modello distillato a pochi step.',
    'Il pezzo pesante è il text encoder da 8B: è quello che decide l\'ingombro in VRAM, non il DiT da 7B. La generazione paga più step degli altri modelli della sezione.',
    'A 40 step il costo è alto (~77 s a 512² senza ottimizzazioni). Con il caching dei blocchi DiT (cache-dit) scende a ≈21 s sullo stesso seed, senza perdita visibile: è attivo di default per questo modello (disattivabile con PALAMEDE_SD_CACHE=0).',
  ],
  specs: {
    'Parametri': '7B (32 layer DiT single-stream), quantizzato Q4_K_M',
    'Peso disco': '≈ 10,0 GB totali (DiT 4,2 + Qwen3-VL-8B TE 5,1 + VAE 0,68)',
    'Text encoder': 'Qwen3-VL-8B-Instruct (GGUF UD-Q4_K_XL)',
    'VAE': 'Qwen-Image 2.1 (bf16)',
    'Step': '40 (consigliati)',
    'CFG': '6.0 · sampler euler',
    'Risoluzioni': 'nativo ad alta risoluzione (fino a 2048²); 1024² il compromesso pratico',
    'Tempo 512²': '≈21 s (40 step, cache-dit) · ≈77 s senza cache — misurato',
    'Tempo 1024²': '≈93 s (40 step, cache-dit)',
    'VRAM misurata': '≈12 GB (TE da 8B: il più esigente della sezione)',
    'Endpoint': 'POST /api/image (hub —> :8000/generate, backend sd-server)',
  },
  quality: [
    'Pensato per testo nell\'immagine e fotorealismo: è il modello più grande della sezione (7B).',
    'Nel modello originale l\'editing va oltre: più immagini di riferimento (fino a 10) e PNG trasparenti (RGBA). Qui la UI copre text-to-image e image-to-image da una singola immagine (init image + forza), non l\'editing multi-reference.',
    'Il costo è il tempo e la VRAM: non coesiste con altri modelli sulla GPU.',
  ],
  examples: [],
}

export const QWENIMAGEEDIT: ModelWiki = {
  id: 'qwenimageedit',
  name: 'Qwen-Image-Edit 2509 — Q3_K_M',
  family: 'Qwen (Alibaba) · DiT 20B + Qwen2.5-VL',
  how: [
    'Qwen-Image-Edit 2509 è la versione di settembre di Qwen-Image-Edit: fa solo editing, non text-to-image. Non descrivi un\'immagine, dai un\'istruzione — "metti la neve per strada", "il testo in blu", "portalo in acquerello" — e il modello modifica quella che gli dai.',
    'Il GGUF Q3_K_M (unsloth Dynamic 2.0) è il solo denoiser. Il prompt e l\'immagine di partenza passano entrambi dal text encoder Qwen2.5-VL-7B, che è anche la vista: l\'istruzione viene letta insieme all\'immagine e produce i condizionamenti sia per il VLM sia per il DiT. Per questo l\'editing di questo modello non è un img2img con una soglia di denoise: non esiste un cursore di "forza", perché la quantità di cambiamento la decide il modello in base all\'istruzione.',
    'A differenza di Qwen-Image 2.1, che usa il text encoder Qwen3-VL, qui l\'architettura del prompt è quella di Qwen2.5-VL: i due non sono intercambiabili, e la VAE è quella originale di Qwen-Image (quella di Qwen-Image 2.1 ha blocchi più larghi e viene rifiutata in carico).',
    'Gira in stable-diffusion.cpp come gli altri modelli sd-server, con cfg 2.5, sampler euler e flow-shift 3 come da guida, e il caching dei blocchi DiT attivo di default (40 step sono molti).',
  ],
  specs: {
    'Parametri': 'DiT ~20B quantizzato Q3_K_M + text encoder Qwen2.5-VL-7B',
    'Peso disco': '≈ 14,7 GB (DiT 9,7 + TE 4,7 + VAE 0,25)',
    'Text encoder': 'Qwen2.5-VL-7B-Instruct (GGUF Q4_K_M) + mmproj visione',
    'VAE': 'Qwen-Image originale (AutoencoderKLQwenImage)',
    'Step': '20 (misurati: sotto i 20 non si guadagna tempo, sopra non si vede)',
    'CFG': '2.5 · sampler euler · flow-shift 3',
    'Uso': 'solo image editing: immagine di partenza obbligatoria',
    'Tempo 512²': '71 s a 20 step · 115 s a 40 step · 61 s a 8 step — metà del tempo è un costo fisso di ~50 s (encoding dell\'istruzione col text encoder su CPU), gli step aggiungono ~2 s a testa',
    'Confronto online': 'su RTX 5060 Ti 16GB, in ComfyUI, altri misurano ~224 s a 20 step col GGUF Q4_K_M e ~30 s a 4 step con il Lightning LoRA',
    'VRAM misurata': '≈ 9,3 GB in VRAM (DiT 9,3 + VAE 0,24) + ≈ 5,3 GB in RAM per il text encoder',
    'Endpoint': 'POST /api/image (hub —> :8000/generate, backend sd-server)',
  },
  quality: [
    'Punto di forza: la consistenza dell\'identità. Volti e prodotti restano riconoscibili mentre cambiano pose, sfondo o stile — è la specialità dichiarata del 2509.',
    'Eccellente anche sul testo: oltre a cambiarne il contenuto, ne cambia font, colore e materiale, cosa che i modelli di editing più piccoli raramente fanno bene.',
    'Multi-immagine da 1 a 3 input (persone + persone, persona + prodotto, persona + scena) e keypoint/schizzi come guida: capacità che la UI attuale non espone ancora, la pagina copre una sola immagine di partenza.',
    'Il costo è alto: ~14 GB di pesi, DiT da 9,3 GB in VRAM e un text encoder da 5,3 GB che gira su CPU. Non coesiste con nessun altro modello.',
  ],
  examples: [
    { file: 'qwenimageedit-snow.png', prompt: 'make it snow on the ground', note: '512² · 71 s a 20 step — la struttura resta, cambia solo la quantità di neve' },
    { file: 'qwenimageedit-snow-8step.png', prompt: 'make it snow on the ground', note: '512² · 61 s a 8 step — la stessa scena, aghi più fusi: non vale i 20' },
  ],
}

export const IMAGE_MODELS = [BONSAI, ZIMAGE, KLEIN, QWENIMAGE, QWENIMAGEEDIT]

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
      'Strumenti': 'palamede.generate_image previsto; text/video/rag in seguito',
      'Dipendenze': 'nessuna lato agent (client MCP standard)',
      'Stato': 'bozza — implementazione prevista',
    },
    needs: ['mcp/server.mjs che inviluppa POST /api/image come tool MCP'],
  },
]
