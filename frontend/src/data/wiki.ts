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
    'Risoluzioni': 'multipli di 32, 256–2048; preset: 512², 1024², 640×416, 1248×832, 416×640, 1408×704, 704×1408',
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
    'VRAM misurata': '≈ 5 GB residente (TE da 3.5 GB su RAM via --backend te=cpu; tutto su GPU: ≈ 8.5 GB)',
    'Tempo 512²': '3.3 s warm (5.6 s primo colpo)',
    'Tempo 1024²': '17.8 s warm',
    'Tempo 1248×832': '≈ 16.6 s warm',
    'Step': '8 (distillato)',
    'CFG': '1.0 — alzarlo degrada',
    'Risoluzioni': 'consigliato 1024² nativo; supportato fino a ~1408×704',
    'Endpoint': 'POST http://127.0.0.1:8123/sdapi/v1/{txt2img,img2img} (sd-server)',
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
    'Tempo 512²': '≈ 3.6 s txt2img · ≈ 1.8 s img2img (4 step)',
    'Step': '4–8 (distillato)',
    'CFG': '1.0',
    'Endpoint': 'POST /generate con "image" + "strength" (img2img)',
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
    'A 40 step il costo è alto (~77 s a 512² senza ottimizzazioni). Con il caching dei blocchi DiT (cache-dit) scende a ~33 s sullo stesso seed, senza perdita visibile: è attivo di default per questo modello (disattivabile con PALAMEDE_SD_CACHE=0).',
  ],
  specs: {
    'Parametri': '7B (32 layer DiT single-stream), quantizzato Q4_K_M',
    'Peso disco': '≈ 10,0 GB totali (DiT 4,2 + Qwen3-VL-8B TE 5,1 + VAE 0,68)',
    'Text encoder': 'Qwen3-VL-8B-Instruct (GGUF UD-Q4_K_XL)',
    'VAE': 'Qwen-Image 2.1 (bf16)',
    'Step': '40 (consigliati)',
    'CFG': '6.0 · sampler euler',
    'Risoluzioni': 'nativo ad alta risoluzione (fino a 2048²); 1024² il compromesso pratico',
    'Tempo 512²': '≈33 s (40 step, cache-dit) · ≈77 s senza cache — misurato',
    'Tempo 1024²': 'da misurare su questa macchina',
    'VRAM misurata': 'da misurare (TE da 8B: il più esigente della sezione)',
    'Endpoint': 'POST http://127.0.0.1:8123/sdapi/v1/{txt2img,img2img} (sd-server)',
  },
  quality: [
    'Pensato per testo nell\'immagine e fotorealismo: è il modello più grande della sezione (7B).',
    'Nel modello originale l\'editing va oltre: più immagini di riferimento (fino a 10) e PNG trasparenti (RGBA). Qui la UI copre text-to-image e image-to-image da una singola immagine (init image + forza), non l\'editing multi-reference.',
    'Il costo è il tempo e la VRAM: non coesiste con altri modelli sulla GPU.',
  ],
  examples: [],
}

export const IMAGE_MODELS = [BONSAI, ZIMAGE, KLEIN, QWENIMAGE]

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
