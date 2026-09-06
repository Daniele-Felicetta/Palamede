<script lang="ts">
  import { onMount } from "svelte";
  import { navigate, route } from "../../../router.svelte";
  import { Images } from "../../../lib/images";
  import { Text } from "../../../lib/text";
  import {
    chatStream,
    generateQuick,
    getChatStatus,
    startChat,
    type ChatContentPart,
    type GenImage,
  } from "../../../api";
  import {
    GENRES,
    STYLES,
    styleById,
    DEFAULT_IMAGE_MODEL,
    NARRATOR_SYSTEM,
    chapter1Fragment,
    nextChapterFragment,
    branchAFragment,
    branchBFragment,
    firstSentence,
    imagePrompt,
  } from "./data";
  import { gameSession } from "./session.svelte";

  interface Branch {
    label: string;
    im: GenImage;
  }

  interface Chapter {
    text: string;
    im: GenImage;
  }

  let chapters = $state<Chapter[]>([]); // capitoli conclusi
  let story = $state(""); // capitolo corrente (streaming)
  let im = $state<GenImage | null>(null); // illustrazione del capitolo corrente
  let branches = $state<Branch[]>([]); // i due sentieri
  let page = $state(0); // 0 = capitolo · 1 = sentiero A · 2 = sentiero B
  let streamDone = $state(false);
  let hint = $state("");
  let busy = $state(false);
  let prep = $state(false); // preparazione in background già avviata
  let genId = 0; // guardia contro scritture di generazioni superate
  // Narratore: Ornith 35B-A3B con visione (mmproj) via llama-server del hub.
  // La qualità è eccellente; con gli esperti MoE su RAM (cpuMoe -1) la VRAM
  // scende da ~16 a ~7.7 GB e il generatore immagini ci sta insieme (il
  // decode resta ~8 tok/s). Vedi data.ts per il system prompt di ruolo.
  const CHAT_MODEL: Text.ModelId = "ornith-35b";
  // cpuMoe -1 = tutti gli esperti MoE su RAM (coesistenza con i modelli
  // immagine); i default del registro Text valgono per il resto.
  const CHAT_OVERRIDES = { cpuMoe: -1 } as const;

  // Parametri della partita: genere dalla rotta /bandersnatch/<genere>,
  // stile e nome dalla sessione impostata nel setup.
  const genreFromRoute = $derived.by(() => {
    const m = /^\/bandersnatch\/([^/]+)$/.exec(route.path);
    if (!m) return "";
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  });
  const genre = $derived(genreFromRoute || gameSession.genre || GENRES[0]);
  const style = $derived(styleById(gameSession.style || STYLES[0].id));
  const name = $derived(gameSession.name.trim() || "Viandante");
  const model = $derived<Images.ModelId>(
    (gameSession.model || DEFAULT_IMAGE_MODEL) as Images.ModelId,
  );

  const fullStory = $derived(
    chapters.map((c) => c.text).join("\n\n") + (story ? "\n\n" + story : ""),
  );
  const chapterReady = $derived(streamDone && !!im);

  // Riduce un dataURL via canvas (JPEG, max `max` px lato lungo): le immagini
  // compatte pesano poco sul contesto del modello vision-language.
  function downscaleDataUrl(dataUrl: string, max = 448): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("canvas non disponibile"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("immagine non leggibile"));
      img.src = dataUrl;
    });
  }

  // Il modello vision-language (llama-server) può guardare le illustrazioni
  // già prodotte: il contesto visivo dei capitoli conclusi viene ridotto e
  // incluso nel messaggio per mantenere la coerenza tra le scene.
  const contextImages = async (): Promise<
    { type: "image_url"; image_url: { url: string } }[]
  > => {
    const urls = chapters.map((c) => c.im.dataUrl);
    if (!urls.length) return [];
    const small = await Promise.all(urls.map((u) => downscaleDataUrl(u)));
    return small.map((url) => ({ type: "image_url", image_url: { url } }));
  };

  const ask = async (fragment: string, withImages = false): Promise<string> => {
    const content: string | ChatContentPart[] = withImages
      ? [
          { type: "text", text: fragment },
          ...(await contextImages()),
        ]
      : fragment;
    const stream = await chatStream(
      [{ role: "user", content }],
      0.6,
      NARRATOR_SYSTEM,
      200,
    );
    return new Promise((resolve, reject) => {
      let out = "";
      Text.stream(
        stream,
        (type, t) => { if (type === "content") out += t },
        () => resolve(out.trim()),
        (e) => reject(e),
      );
    });
  };

  // Immagine col modello scelto all'inizio (default Z-Image), step consigliati.
  const genImage = async (prompt: string): Promise<GenImage> => {
    const [img] = await generateQuick(prompt, {
      model,
      steps: Images.DEFAULT_STEPS[model],
    });
    return img;
  };

  // Il modello a volte ripete in testa il frammento che gli abbiamo passato
  // (eco dell'ultima frase del contesto): toglie le righe iniziali uguali.
  const stripEcho = (out: string, fragment: string): string => {
    let t = out.trimStart();
    for (const line of fragment.split("\n")) {
      const clean = line.trim();
      if (!clean) continue;
      if (!t.startsWith(clean)) break;
      t = t.slice(clean.length).trimStart();
    }
    return t;
  };

  // Prepara in parallelo, mentre il testo ancora scorre:
  //  1) l'immagine del capitolo corrente (se non è già pronta);
  //  2) le frasi e le immagini dei due sentieri della prossima scelta.
  const firePrep = () => {
    if (prep) return;
    prep = true;
    const id = ++genId;
    void (async () => {
      if (!im) {
        if (id !== genId) return;
        // scena dell'immagine: la prima frase del capitolo (ambientazione)
        im = await genImage(imagePrompt(firstSentence(story), style));
      }
      const tail = fullStory.slice(-900);
      const fa = branchAFragment(tail, name);
      const fb = branchBFragment(tail, name);
      const a = stripEcho(await ask(fa, true), fa);
      const b = stripEcho(await ask(fb, true), fb);
      if (id !== genId) return;
      const [ia, ib] = await Promise.all([
        genImage(imagePrompt(a || tail, style)),
        genImage(imagePrompt(b || tail, style)),
      ]);
      if (id !== genId) return;
      branches = [
        { label: firstSentence(a) || "Un'ombra nella nebbia", im: ia },
        { label: firstSentence(b) || "Una porta che non c'era", im: ib },
      ];
    })();
  };

  const streamChapter = async (prompt: string) => {
    prep = false;
    streamDone = false;
    busy = true;
    hint = "";
    try {
      const images = await contextImages();
      const stream = await chatStream(
        [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...images],
          },
        ],
        0.6,
        NARRATOR_SYSTEM,
        400,
      );
      await new Promise<void>((resolve, reject) => {
        Text.stream(
          stream,
          (type, t) => {
            if (type !== "content") return;
            story += t;
            if (!prep && story.length >= 100) firePrep();
          },
          () => resolve(),
          (e) => reject(e),
        );
      });
      streamDone = true;
      if (!prep) firePrep(); // capitolo molto corto: prepara comunque
    } catch (e) {
      hint = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  };

  const start = async () => {
    chapters = [];
    story = "";
    im = null;
    branches = [];
    page = 0;
    genId = 0;
    await streamChapter(chapter1Fragment(genre, name));
  };

  const chooseFork = async (i: number) => {
    if (busy || i >= branches.length || !branches[i]) return;
    const b = branches[i];
    chapters = [...chapters, { text: story, im: im! }];
    story = "";
    im = b.im; // l'immagine scelta illustra il capitolo che viene
    branches = [];
    page = 0;
    const base = chapters.map((c) => c.text).join("\n\n");
    await streamChapter(nextChapterFragment(base, b.label, name));
  };

  const rigenera = () => {
    if (!busy) start();
  };

  const esci = () => {
    gameSession.genre = "";
    navigate("/bandersketch");
  };

  // Garantisce che il server chat (llama-server) sia attivo con il narratore
  // vision-language: come fa generateQuickText, se è spento o ha un altro
  // modello lo avvia con i default di fabbrica del registro Text.
  const ensureChat = async () => {
    const st = await getChatStatus().catch(() => null);
    if (!st?.running || !st.ready || st.model !== CHAT_MODEL) {
      hint = "sto caricando il narratore (Ornith 35B)…";
      await startChat({ model: CHAT_MODEL, ...Text.defaultsFor(CHAT_MODEL), ...CHAT_OVERRIDES });
    }
  };

  onMount(() => {
    // Prima il narratore in VRAM, poi si parte: la prima storia deve già
    // trovare llama-server pronto con il modello giusto.
    ensureChat()
      .then(() => { hint = ""; start(); })
      .catch((e) => {
        hint = e instanceof Error ? e.message : String(e);
      });
  });
</script>

<section class="oracle" aria-label="Bandersketch — la storia">
  <header class="oracle-head">
    <div class="oracle-brand">
      <span class="oracle-glyph" aria-hidden="true">☾</span>
      <div>
        <h1>Bandersketch</h1>
        <p>dove ogni scelta è un enigma</p>
      </div>
    </div>
    <div class="oracle-chips" aria-label="Partita">
      <span class="chip">{genre}</span>
      <span class="chip">{style.label}</span>
      <span class="chip">{Images.modelName(model)}</span>
      <span class="chip">{name}</span>
      <span class="chip">narratore · {Text.modelName(CHAT_MODEL)}</span>
    </div>
    <div class="oracle-actions">
      <button class="oracle-link" onclick={rigenera} disabled={busy}>
        ↺ rigenera
      </button>
      <button class="oracle-link" onclick={esci}>← esci</button>
    </div>
  </header>

  <div class="oracle-body">
    {#if hint}
      <p class="oracle-err" role="status">{hint}</p>
    {/if}

    {#if page === 0}
      <!-- pagina del capitolo: storia a sinistra, immagine a destra -->
      <div class="book-spread">
        <div class="book-left">
          <p class="oracle-num">
            capitolo {chapters.length + 1}
            {#if !streamDone}<span class="oracle-live">· l'oracolo scrive…</span>{/if}
          </p>
          <div class="oracle-text">{fullStory}</div>
        </div>
        <div class="book-right">
          {#if im}
            <figure class="oracle-fig">
              <img
                src={im.dataUrl}
                alt={`Illustrazione del capitolo ${chapters.length + 1}`}
                loading="lazy"
              />
            </figure>
          {:else}
            <div class="fig-placeholder" role="status">
              <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <p>l'oracolo dipinge…</p>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- pagina del sentiero: una biforcazione per pagina -->
      {#if branches[page - 1]}
        <div class="fork-page">
          <p class="oracle-num">sentiero {page} di 2</p>
          <img
            src={branches[page - 1].im.dataUrl}
            alt={`Sentiero ${page}`}
            loading="lazy"
          />
          <p class="oracle-path-label">{branches[page - 1].label}</p>
          <button
            class="oracle-btn"
            onclick={() => chooseFork(page - 1)}
            disabled={busy}
          >
            Scegli questo sentiero
          </button>
        </div>
      {:else}
        <div class="fork-loading" role="status">
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <p>l'oracolo prepara i sentieri…</p>
        </div>
      {/if}
    {/if}

    <nav class="book-nav" aria-label="Pagine">
      <button
        class="book-arrow"
        onclick={() => (page -= 1)}
        disabled={page === 0}
        aria-label="Pagina precedente"
      >
        ←
      </button>
      <span class="book-page-num">pag. {page + 1} / 3</span>
      <button
        class="book-arrow"
        onclick={() => (page += 1)}
        disabled={page === 2 || (page === 0 && !chapterReady)}
        aria-label="Pagina successiva"
      >
        →
      </button>
    </nav>
  </div>
</section>

<style>
  .oracle {
    --void: #0b0d12;
    --panel: #12141c;
    --line: #262b38;
    --parch: #e7e0cc;
    --parch-dim: #9a958a;
    --ember: #c9995e;
    --ember-soft: rgba(201, 153, 94, 0.16);
    --err: #d98a8a;

    background:
      radial-gradient(900px 420px at 50% -8%, var(--ember-soft), transparent 60%),
      var(--void);
    color: var(--parch);
    min-height: 72vh;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 46px 30px 64px;
    font-family: Georgia, "Times New Roman", serif;
  }

  .oracle-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    max-width: 1020px;
    margin: 0 auto 40px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line);
  }

  .oracle-brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .oracle-glyph {
    color: var(--ember);
    font-size: 26px;
    line-height: 1;
  }

  .oracle-brand h1 {
    margin: 0;
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 5px;
    text-transform: uppercase;
  }

  .oracle-brand p {
    margin: 2px 0 0;
    font-style: italic;
    color: var(--parch-dim);
    font-size: 14px;
  }

  .oracle-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .oracle-chips .chip {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--parch-dim);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 3px 10px;
  }

  .oracle-actions {
    display: flex;
    gap: 12px;
  }

  .oracle-link {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--parch-dim);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 2px;
  }

  .oracle-link:hover:not(:disabled) {
    color: var(--ember);
  }

  .oracle-link:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .oracle-body {
    max-width: 1020px;
    margin: 0 auto;
  }

  /* ── pagina del capitolo: libro aperto ── */
  .book-spread {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    gap: 40px;
    align-items: start;
  }

  @media (max-width: 900px) {
    .book-spread {
      grid-template-columns: 1fr;
    }
  }

  .oracle-num {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--parch-dim);
    margin: 0 0 18px;
  }

  .oracle-live {
    color: var(--ember);
  }

  .oracle-text {
    font-size: 18px;
    line-height: 1.9;
    color: var(--parch);
    white-space: pre-wrap;
  }

  .oracle-fig {
    margin: 0;
  }

  .oracle-fig img {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 6px;
    display: block;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.4);
  }

  .fig-placeholder {
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed var(--line);
    border-radius: 6px;
    color: var(--parch-dim);
    font-style: italic;
    font-size: 14px;
  }

  .fig-placeholder p {
    margin: 0;
  }

  /* ── pagina del sentiero ── */
  .fork-page {
    max-width: 540px;
    margin: 0 auto;
    text-align: center;
  }

  .fork-page img {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 8px;
    display: block;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.4);
  }

  .fork-page .oracle-path-label {
    font-size: 17px;
    font-style: italic;
    line-height: 1.6;
    margin: 18px 0 24px;
  }

  .fork-loading {
    max-width: 540px;
    margin: 0 auto;
    text-align: center;
    color: var(--parch-dim);
    font-style: italic;
    font-size: 15px;
    padding: 70px 0;
  }

  .fork-loading p {
    margin: 10px 0 0;
  }

  .oracle-btn {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--ember);
    background: transparent;
    border: 1px solid var(--ember);
    border-radius: 3px;
    padding: 12px 30px;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }

  .oracle-btn:hover:not(:disabled) {
    background: var(--ember);
    color: var(--void);
  }

  .oracle-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── navigazione tra le pagine ── */
  .book-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    margin-top: 38px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }

  .book-page-num {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--parch-dim);
    text-transform: uppercase;
    min-width: 64px;
    text-align: center;
  }

  .book-arrow {
    font-family: var(--mono);
    font-size: 16px;
    color: var(--parch);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 50%;
    width: 44px;
    height: 44px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s, color 0.2s, box-shadow 0.2s;
  }

  .book-arrow:hover:not(:disabled) {
    border-color: var(--ember);
    color: var(--ember);
    box-shadow: 0 0 18px var(--ember-soft);
  }

  .book-arrow:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── indicatori ── */
  .dots {
    display: inline-block;
  }

  .dots i {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ember);
    margin: 0 3px;
    animation: oracle-blink 1.2s infinite;
  }

  .dots i:nth-child(2) {
    animation-delay: 0.2s;
  }

  .dots i:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes oracle-blink {
    0%,
    100% {
      opacity: 0.2;
    }
    50% {
      opacity: 1;
    }
  }

  .oracle-err {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--err);
    text-align: center;
    margin: 0 0 20px;
  }
</style>