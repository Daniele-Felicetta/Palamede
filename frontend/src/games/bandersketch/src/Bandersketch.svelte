<script lang="ts">
  import { onMount } from "svelte";
  import "./game.css";
  import { navigate, route } from "../../../router.svelte";
  import { Images } from "../../../lib/images";
  import { Text } from "../../../lib/text";
  import {
    chatStream,
    narrateStream,
    generateQuick,
    getChatStatus,
    selectModel,
    startChat,
    stopChat,
    saveStory,
    type ChatContentPart,
    type GenImage,
  } from "../../../api";
  import {
    GENRES,
    STYLES,
    styleById,
    DEFAULT_IMAGE_MODEL,
    DEFAULT_IMAGE_SIZE,
    sizeById,
    STORY_LENGTH,
    DEFAULT_NARRATOR,
    NARRATOR_SYSTEM,
    chapter1Fragment,
    nextChapterFragment,
    finaleFragment,
    branchAFragment,
    branchBFragment,
    firstSentence,
    sceneSnippet,
    branchLabel,
    groundedIn,
    repeatsTail,
    isGeminiNarrator,
    geminiLabel,
    tailContext,
    stripEcho,
    imagePrompt,
  } from "./data";
  import { gameSession, clearSession } from "./session.svelte";

  interface Branch {
    label: string;
    full: string; // scena intera del sentiero: il capitolo dopo riparte da qui
    scene: string; // soggetto dato al pittore (diagnostica testo↔immagine)
    im: GenImage;
  }

  interface Chapter {
    text: string;
    scene: string; // soggetto dato al pittore per la tavola del capitolo
    prompt: string; // frammento che l'ha generato (dataset futuro)
    rating: number; // 1 = 👍, -1 = 👎, 0 = non votato
    im: GenImage;
  }

  interface ForkLog {
    chapter: number;
    options: { label: string; scene: string; prompt: string; seed: number; timeMs: number; img: string }[];
    picked: number | null;
  }

  let chapters = $state<Chapter[]>([]); // capitoli conclusi
  let story = $state(""); // capitolo corrente (streaming)
  let chapterPrompt = ""; // frammento che sta generando il capitolo corrente
  let im = $state<GenImage | null>(null); // illustrazione del capitolo corrente
  let imScene = ""; // soggetto con cui è stata chiesta l'illustrazione corrente
  let branches = $state<Branch[]>([]); // i due sentieri
  let forkLog = $state<ForkLog[]>([]); // bivi proposti + scelta (archivio)
  let sessionId = $state(""); // id partita per l'archivio storie
  let lastChoice = $state<{ label: string; full: string } | null>(null); // via scelta: epigrafe del capitolo nuovo
  let curRating = $state(0); // voto del capitolo corrente: 1 👍 · -1 👎 · 0 nessuno
  let spread = $state(0); // apertura del libro: 0 = capitolo (storia|immagine) · 1 = bivio (A|B)
  let streamDone = $state(false);
  let hint = $state("");
  let busy = $state(false);
  let prep = $state(false); // preparazione in background già avviata
  let prepErr = $state(""); // errore della preparazione in background ("" = tutto ok)
  let theEnd = $state(false); // ultimo capitolo concluso: la storia è finita
  let unsentImgs: Record<string, string> = {}; // tavole non ancora confermate dall'archivio
  let genId = 0; // guardia contro scritture di generazioni superate
  // Narratore scelto nel setup (default Gemma 4 26B): vision-language con
  // mmproj, vede le tavole e ancora i bivi a ciò che si mostra nel libro.
  // Gemma/35B girano con esperti MoE su RAM (coesistenza col pittore),
  // Ornith 9B denso va tutto in GPU. Vedi data.ts NARRATOR_MODELS.
  // Le voci gemini-* sono cloud (hub /api/narrate, chiave server-side):
  // niente llama-server da caricare, anzi lo si spegne per liberare VRAM.
  const NARRATOR_ID = $derived(gameSession.narrator || DEFAULT_NARRATOR);
  const IS_GEMINI = $derived(isGeminiNarrator(NARRATOR_ID));
  const NARRATOR_LABEL = $derived(
    IS_GEMINI ? geminiLabel(NARRATOR_ID) : Text.modelName(NARRATOR_ID),
  );
  const CHAT_MODEL = $derived<Text.ModelId>(
    (IS_GEMINI ? DEFAULT_NARRATOR : NARRATOR_ID) as Text.ModelId,
  );
  const CHAT_OVERRIDES = $derived(
    CHAT_MODEL === "ornith-9b"
      ? ({ context: 4096, kv: "q8_0" } as const)
      : ({ cpuMoe: -1, context: 4096, kv: "q4_0" } as const),
  );

  // Parametri della partita: genere dalla rotta /bandersketch/<genere>,
  // stile e nome dalla sessione impostata nel setup.
  const genreFromRoute = $derived.by(() => {
    const m = /^\/bandersketch\/([^/]+)$/.exec(route.path);
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

  // Testo intero della partita fin qui (capitoli chiusi + corrente): calcolato
  // solo quando serve (frammenti di bivio/finale), non a ogni token in arrivo.
  const fullText = () =>
    chapters.map((c) => c.text).join("\n\n") + (story ? "\n\n" + story : "");
  const chapterReady = $derived(streamDone && !!im && !theEnd);
  const chapterHint = $derived(
    theEnd
      ? "fine della storia — ↺ rigenera per ricominciare"
      : prepErr && !busy
        ? `preparazione fallita: ${prepErr}`
        : chapterReady
          ? "i sentieri sono pronti — volta pagina"
          : "aspetta che oracolo e pittore finiscano…",
  );

  // Il modello vision-language (llama-server) può guardare le illustrazioni
  // già prodotte: il contesto visivo dei capitoli conclusi viene ridotto
  // (lib/images.ts) e incluso nel messaggio per coerenza tra le scene.
  const contextImages = async (): Promise<
    { type: "image_url"; image_url: { url: string } }[]
  > => {
    // Solo le ultime 2 tavole: oltre non aggiunge coerenza ma rallenta il
    // narratore (ogni immagine = tanti token visivi a ~8 tok/s di decode).
    const urls = chapters.map((c) => c.im.dataUrl).slice(-2);
    if (!urls.length) return [];
    const small = await Promise.all(urls.map((u) => Images.downscaleDataUrl(u)));
    return small.map((url) => ({ type: "image_url", image_url: { url } }));
  };

  const ask = async (
    fragment: string,
    scene: string[] = [], // dataUrl già ridotte (es. la tavola corrente)
    maxTokens = 200,
    temperature = 0.6,
  ): Promise<string> => {
    // La tavola corrente (scene) da sola è veloce (1 immagine); le tavole
    // passate costano decode a ~8 tok/s e restano fuori da questo path.
    const content: string | ChatContentPart[] =
      scene.length
        ? [
            { type: "text", text: fragment },
            ...scene.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ]
        : fragment;
    const stream = IS_GEMINI
      ? await narrateStream(
          NARRATOR_ID,
          content,
          temperature,
          NARRATOR_SYSTEM,
          maxTokens,
        )
      : await chatStream(
          [{ role: "user", content }],
          temperature,
          NARRATOR_SYSTEM,
          maxTokens,
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

  // Formato tavole scelto nel setup (default 512²: nel libro occupano ~500px,
  // inutile pagare 1024² — zimage 1024² ≈ 17s vs 512² ≈ 3-6s).
  const bookSize = $derived(sizeById(gameSession.size || DEFAULT_IMAGE_SIZE));
  const BOOK_W = $derived(bookSize.w);
  const BOOK_H = $derived(bookSize.h);

  // Immagine col modello scelto all'inizio (default Z-Image), step consigliati.
  // Lancia se il backend non restituisce tavole: l'errore finisce in prepErr
  // (mai un `im` indefinito in giro per il gioco).
  const genImage = async (prompt: string): Promise<GenImage> => {
    const [img] = await generateQuick(prompt, {
      model,
      steps: Images.DEFAULT_STEPS[model],
      width: BOOK_W,
      height: BOOK_H,
    });
    if (!img) throw new Error("il pittore non ha restituito immagini");
    return img;
  };

  // Prepara in parallelo, mentre il testo ancora scorre:
  //  1) l'immagine del capitolo corrente (se non è già pronta);
  //  2) le frasi e le immagini dei due sentieri della prossima scelta
  //     (solo se il capitolo non è il finale: dopo l'ultimo non c'è bivio).
  // Idempotente fino al completamento: se fallisce a metà non scrive nulla di
  // parziale (bivi e forkLog si assegnano solo alla fine) e si può riprovare.
  const firePrep = () => {
    if (prep) return;
    prep = true;
    prepErr = "";
    const id = ++genId;
    void (async () => {
      if (!im) {
        if (id !== genId) return;
        // scena dell'immagine: la prima frase del capitolo (ambientazione)
        imScene = firstSentence(story);
        im = await genImage(imagePrompt(imScene, style));
      }
      // Ultimo capitolo: ha la sua tavola ma nessun bivio — qui ci si ferma.
      if (chapters.length + 1 >= STORY_LENGTH) return;
      // Coda al confine di frase: il taglio cieco lascia monconi e il
      // narratore inventa elementi scollegati (verificato con test live).
      const tail = tailContext(fullText(), 900);
      const fa = branchAFragment(tail, name);
      const fb = branchBFragment(tail, name);
      // La tavola corrente ancora la visione: il bivio descrive davvero ciò
      // che si vede nell'illustrazione (test live: neve/albero ripresi).
      // Solo 1 immagine — non tutta la storia — per non rallentare il decode.
      const scene = im
        ? await Images.downscaleDataUrl(im.dataUrl)
            .then((u) => [u])
            .catch(() => [] as string[])
        : [];
      // Testo dei due sentieri in parallelo, con la scena corrente. Budget
      // 280 token: a 200 le scene venivano troncate a metà frase (test e2e).
      // Se un bivio non continua la scena (invenzioni dal nulla: "sfera",
      // "capanna" al posto di "stalla") o la RICOPIA ("Gino rimase immobile…"
      // già letto nel capitolo), UN solo retry a temp bassa; se resta
      // scollegato si tiene comunque — il gioco non deve mai bloccarsi.
      const brew = async (frag: string) => {
        const good = (t: string) => groundedIn(t, tail) && !repeatsTail(t, tail);
        const first = stripEcho(await ask(frag, scene, 280, 0.5), frag);
        if (good(first)) return first;
        const second = stripEcho(await ask(frag, scene, 280, 0.3), frag);
        if (good(second)) return second;
        // Ripiego: meglio ancorato che originale — ma mai una copia se c'è
        // un'alternativa ancorata.
        const cands = [first, second].filter((t) => groundedIn(t, tail) && !repeatsTail(t, tail));
        if (cands.length) return cands.sort((x, y) => y.length - x.length)[0];
        const anchored = [first, second].filter((t) => groundedIn(t, tail));
        if (anchored.length) return anchored.sort((x, y) => y.length - x.length)[0];
        return first.length >= second.length ? first : second;
      };
      const [a, b] = await Promise.all([brew(fa), brew(fb)]);
      if (id !== genId) return;
      // Soggetto da due frasi: più ancorato alla scena del bivio.
      const sceneA = sceneSnippet(a) || tail;
      const sceneB = sceneSnippet(b) || tail;
      const [ia, ib] = await Promise.all([
        genImage(imagePrompt(sceneA, style)),
        genImage(imagePrompt(sceneB, style)),
      ]);
      if (id !== genId) return;
      const n = chapters.length + 1;
      branches = [
        { label: branchLabel(a, "Un'ombra nella nebbia"), full: a, scene: sceneA, im: ia },
        { label: branchLabel(b, "Una porta che non c'era"), full: b, scene: sceneB, im: ib },
      ];
      forkLog = [
        ...forkLog,
        {
          chapter: n,
          options: [
            { label: branches[0].label, scene: sceneA, prompt: fa, seed: ia.seed, timeMs: ia.timeMs, img: `ch${n}a.png` },
            { label: branches[1].label, scene: sceneB, prompt: fb, seed: ib.seed, timeMs: ib.timeMs, img: `ch${n}b.png` },
          ],
          picked: null,
        },
      ];
      saveSnapshot();
    })().catch((e) => {
      // Preparazione fallita (pittore o narratore non raggiungibili): nessuna
      // scrittura parziale da sistemare — mostra l'errore e lascia riprovare
      // (↻ nel libro). prep torna false così retryPrep può ripartire.
      if (id !== genId) return; // superata da una rigenerazione: ignora
      prep = false;
      prepErr = e instanceof Error ? e.message : String(e);
    });
  };

  // Riprova la preparazione fallita (stesso capitolo, stessi spunti).
  const retryPrep = () => {
    if (busy || prep) return;
    prepErr = "";
    firePrep();
  };

  // Archivio storie: snapshot fire-and-forget dal PRIMO capitolo (bivio
  // completo) e a ogni scelta (testi + scene + seed + tavole). Non blocca mai
  // il gioco: le tavole dei bivi chiusi restano su disco dal salvataggio
  // precedente, e quelle dei salvataggi falliti viaggiano con i successivi
  // (unsentImgs) finché l'archivio non le conferma.
  const saveSnapshot = () => {
    if (!sessionId) return;
    // Capitoli chiusi + quello corrente se ha già testo e tavola: l'archivio
    // si riempie da subito, non solo dopo la prima scelta.
    const all = [...chapters];
    if (story && im) all.push({ text: story, scene: imScene, prompt: chapterPrompt, rating: curRating, im });
    if (!all.length && !forkLog.length) return;
    // Tavole da consegnare: capitoli + ultimo bivio ancora aperto, più gli
    // arretrati dei salvataggi falliti. Costruito qui (sincrono) così ogni
    // snapshot porta con sé tutto ciò che l'archivio non ha ancora visto.
    const imgs: Record<string, string> = { ...unsentImgs };
    all.forEach((c, idx) => {
      imgs[`ch${idx + 1}.png`] = c.im.dataUrl;
    });
    const cur = forkLog[forkLog.length - 1];
    if (cur && cur.chapter === all.length && cur.picked === null) {
      branches.forEach((br, k) => {
        if (br?.im?.dataUrl) imgs[cur.options[k].img] = br.im.dataUrl;
      });
    }
    void (async () => {
      try {
        await saveStory({
          id: sessionId,
          meta: {
            genre,
            style: style.label,
            name,
            narrator: NARRATOR_LABEL,
            painter: Images.modelName(model),
            size: `${bookSize.w}x${bookSize.h}`,
          },
          chapters: all.map((c, idx) => ({
            n: idx + 1,
            text: c.text,
            scene: c.scene,
            prompt: c.prompt,
            rating: c.rating,
            seed: c.im.seed,
            timeMs: c.im.timeMs,
            img: `ch${idx + 1}.png`,
          })),
          forks: forkLog.map((f) => ({
            chapter: f.chapter,
            options: f.options,
            picked: f.picked,
          })),
          images: imgs,
        });
        for (const k of Object.keys(imgs)) delete unsentImgs[k];
      } catch {
        // archivio non disponibile: il gioco continua, le tavole restano in
        // coda e verranno riconsegnate col prossimo snapshot.
        Object.assign(unsentImgs, imgs);
      }
    })();
  };

  const streamChapter = async (prompt: string) => {
    prep = false;
    prepErr = "";
    theEnd = false; // verrà rialzato a fine stream se è l'ultimo capitolo
    streamDone = false;
    busy = true;
    hint = "";
    chapterPrompt = prompt; // il frammento va in archivio (dataset futuro)
    try {
      const images = await contextImages();
      const content = [{ type: "text", text: prompt }, ...images] as ChatContentPart[];
      const stream = IS_GEMINI
        ? await narrateStream(NARRATOR_ID, content, 0.6, NARRATOR_SYSTEM, 400)
        : await chatStream(
            [
              {
                role: "user",
                content,
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
      // Ultimo capitolo: niente bivio dopo — la storia finisce qui.
      if (chapters.length + 1 >= STORY_LENGTH) theEnd = true;
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
    chapterPrompt = "";
    curRating = 0;
    im = null;
    imScene = "";
    branches = [];
    forkLog = [];
    lastChoice = null;
    spread = 0;
    theEnd = false;
    prepErr = "";
    unsentImgs = {}; // nuova partita, nuovo archivio: nessun arretrato
    genId++; // invalida preparazioni in volo (mai resettare a 0: gli id vecchi
    //          tornerebbero validi e contaminerebbero la partita nuova)
    sessionId =
      "bs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    await streamChapter(chapter1Fragment(genre, name));
  };

  const chooseFork = async (i: number) => {
    const b = branches[i];
    const plate = im; // la tavola scelta illustra il capitolo che viene
    if (busy || !b || !plate) return;
    chapters = [...chapters, { text: story, scene: imScene, prompt: chapterPrompt, rating: curRating, im: plate }];
    // Il libro volta pagina in avanti: la via scelta diventa l'epigrafe del
    // capitolo nuovo, non si rilegge il testo da capo.
    lastChoice = { label: b.label, full: b.full };
    story = "";
    curRating = 0;
    im = b.im; // l'immagine scelta illustra il capitolo che viene
    imScene = b.scene;
    branches = [];
    forkLog = forkLog.map((f, k) => (k === forkLog.length - 1 ? { ...f, picked: i } : f));
    saveSnapshot();
    spread = 0;
    // Contesto ricco ma al confine di frase; il capitolo riparte dall'intera
    // scena scelta col gancio di conseguenza ("non tornò indietro").
    // Se è l'ultimo (STORY_LENGTH), il narratore chiude invece di rilanciare.
    const base = tailContext(
      chapters.map((c) => c.text).join("\n\n"),
      1200,
    );
    const final = chapters.length + 1 >= STORY_LENGTH;
    await streamChapter(
      final
        ? finaleFragment(base, b.full || b.label, name)
        : nextChapterFragment(base, b.full || b.label, name),
    );
  };

  const rigenera = () => {
    if (!busy) start();
  };

  // Voto del capitolo corrente (dataset futuro: solo i 👍 alleneranno).
  const rate = (v: number) => {
    if (busy) return;
    curRating = curRating === v ? 0 : v;
    saveSnapshot();
  };

  // Riscrive il capitolo corrente dallo stesso frammento (tavola e bivi
  // rifatti da capo): il voto resta a zero finché non voti la nuova versione.
  const regenChapter = () => {
    if (busy || !chapterPrompt) return;
    genId++; // invalida preparazioni in volo
    story = "";
    curRating = 0;
    streamDone = false;
    theEnd = false;
    prepErr = "";
    im = null;
    imScene = "";
    branches = [];
    forkLog = forkLog.filter((f) => f.chapter !== chapters.length + 1);
    spread = 0;
    void streamChapter(chapterPrompt);
  };

  const esci = () => {
    clearSession();
    gameSession.genre = "";
    navigate("/bandersketch");
  };

  // Garantisce il narratore pronto: cloud (Gemini) non richiede nulla sul
  // posto — anzi spegne llama-server per lasciare VRAM al pittore; locale
  // (llama-server) come fa generateQuickText, con i default di fabbrica.
  const ensureChat = async () => {
    if (IS_GEMINI) {
      hint = `narratore cloud (${NARRATOR_LABEL})…`;
      await stopChat().catch(() => null);
      hint = "";
      // Preriscalda il generatore immagini come nel percorso locale.
      selectModel(model).catch(() => {});
      return;
    }
    const st = await getChatStatus().catch(() => null);
    if (!st?.running || !st.ready || st.model !== CHAT_MODEL) {
      hint = `sto caricando il narratore (${Text.modelName(CHAT_MODEL)})…`;
      await startChat({ model: CHAT_MODEL, ...Text.defaultsFor(CHAT_MODEL), ...CHAT_OVERRIDES });
    }
    // Preriscalda il generatore immagini in sottofondo, mentre la storia
    // inizia: la prima illustrazione non deve pagare da sola il cold start
    // di sd-server. Errori qui ignorati: genImage ritenta e li mostra.
    selectModel(model).catch(() => {});
  };

  onMount(() => {
    // Accesso diretto senza partita (niente setup, niente restore): rimanda
    // al setup invece di giocare coi default ("Viandante").
    if (!gameSession.name.trim() && !gameSession.genre) {
      navigate("/bandersketch");
      return;
    }
    // Prima il narratore in VRAM, poi si parte: la prima storia deve già
    // trovare llama-server pronto con il modello giusto.
    ensureChat()
      .then(() => { hint = ""; start(); })
      .catch((e) => {
        hint = e instanceof Error ? e.message : String(e);
      });
  });
</script>

<section class="oracle game-root" aria-label="Bandersketch — la storia">
  <header class="oracle-head game-bar">
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
      <span class="chip">{Images.modelName(model)} · {bookSize.w}²</span>
      <span class="chip">{name}</span>
        <span class="chip">narratore · {NARRATOR_LABEL}</span>
    </div>
    <div class="oracle-actions">
      <button class="oracle-link" onclick={rigenera} disabled={busy}>
        ↺ rigenera
      </button>
      <button class="oracle-link" onclick={esci}>← esci</button>
      <button class="oracle-link" onclick={() => navigate("/")}>⌂ officina</button>
    </div>
  </header>

  <div class="oracle-body">
    {#if hint}
      <p class="oracle-err" role="status">{hint}</p>
    {/if}

    {#if spread === 0}
      <!-- APERTURA 1 — il capitolo: pagina sx storia, pagina dx illustrazione -->
      {#key chapters.length}
        <div class="book" aria-label="Apertura del capitolo">
          <div class="book-pages">
            <article class="page page-left">
              <p class="page-kicker">Bandersketch · capitolo {chapters.length + 1}</p>
              <h2 class="page-title">{genre}</h2>
              <p class="page-rule" aria-hidden="true">❦</p>
              {#if !streamDone}
                <p class="page-live" role="status">l'oracolo scrive…</p>
              {/if}
              {#if lastChoice}
                <blockquote class="choice-mark">✦ la via scelta — “{lastChoice.label}”</blockquote>
              {/if}
              <div class="page-text">{story || " "}</div>
              {#if theEnd}
                <p class="the-end" role="status">❦ fine ❦</p>
              {/if}
              <div class="rate-row" aria-label="Valuta il capitolo">
                <button
                  class="rate-btn {curRating === 1 ? 'on' : ''}"
                  onclick={() => rate(1)}
                  disabled={busy || !streamDone}
                  aria-label="Bel capitolo"
                  title="Bel capitolo: finirà nel dataset per allenare un piccolo narratore"
                >👍</button>
                <button
                  class="rate-btn {curRating === -1 ? 'on' : ''}"
                  onclick={() => rate(-1)}
                  disabled={busy || !streamDone}
                  aria-label="Brutto capitolo"
                  title="Brutto capitolo: da scartare"
                >👎</button>
                <button
                  class="rate-btn"
                  onclick={regenChapter}
                  disabled={busy}
                  aria-label="Riscrivi il capitolo"
                  title="Riscrivi il capitolo dallo stesso spunto"
                >↺</button>
              </div>
              <footer class="folio">— {chapters.length * 2 + 1} —</footer>
            </article>
            <div class="spine" aria-hidden="true"><span></span></div>
            <article class="page page-right">
              <p class="page-kicker">tavola · capitolo {chapters.length + 1}</p>
              {#if im}
                <figure class="plate" title={`tavola del capitolo ${chapters.length + 1} · seme ${im.seed}`}>
                  <img
                    src={im.dataUrl}
                    alt={`Illustrazione del capitolo ${chapters.length + 1}`}
                    loading="lazy"
                  />
                  <figcaption>{firstSentence(story || "l'oracolo dipinge la scena")}</figcaption>
                </figure>
              {:else}
                <div class="plate-placeholder" role="status">
                  {#if prepErr && streamDone && !busy}
                    <p>la tavola non è riuscita ({prepErr}) — premi ↻ qui sotto per riprovare</p>
                  {:else}
                    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
                    <p>l'oracolo dipinge…</p>
                  {/if}
                </div>
              {/if}
              <footer class="folio">— {chapters.length * 2 + 2} —</footer>
            </article>
          </div>
        </div>
      {/key}
      {#if chapters.length}
        <details class="past">
          <summary>capitoli precedenti ({chapters.length}) — rileggi il cammino</summary>
          {#each chapters as c, n (n)}
            <p class="past-num">capitolo {n + 1}</p>
            <p class="past-text">{c.text}</p>
          {/each}
        </details>
      {/if}
    {:else}
      <!-- APERTURA 2 — il bivio: le due biforcazioni fianco a fianco, stesso libro -->
      <div class="book fork" aria-label="Apertura del bivio">
        <p class="fork-head" role="status">
          {#if branches.length === 2}
            la strada si divide — scegli da che parte voltare
          {:else if prepErr && !busy}
            i sentieri non si sono aperti ({prepErr}) — premi ↻ qui sotto per riprovare
          {:else}
            l'oracolo prepara i sentieri…
          {/if}
        </p>
        <div class="book-pages">
          {#each [0, 1] as i (i)}
            <article class="page fork-page {i === 0 ? 'page-left' : 'page-right'}">
              <p class="page-kicker">{i === 0 ? "sentiero Ⅰ — a sinistra" : "sentiero Ⅱ — a destra"}</p>
              {#if branches[i]}
                <figure class="plate fork-plate" title={`sentiero ${i + 1} · seme ${branches[i].im.seed}`}>
                  <img src={branches[i].im.dataUrl} alt={`Sentiero ${i + 1}`} loading="lazy" />
                </figure>
                <p class="fork-label">“{branches[i].label}”</p>
                <button class="seal-btn" onclick={() => chooseFork(i)} disabled={busy}>
                  {#if busy}l'inchiostro asciuga…{:else}imbocca {i === 0 ? "questo" : "quest'altro"} sentiero{/if}
                </button>
              {:else}
                <div class="plate-placeholder" role="status">
                  <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  <p>il sentiero {i === 0 ? "di sinistra" : "di destra"} prende forma…</p>
                </div>
              {/if}
              <footer class="folio">— {chapters.length * 2 + 3 + i} —</footer>
            </article>
            {#if i === 0}<div class="spine" aria-hidden="true"><span></span></div>{/if}
          {/each}
        </div>
      </div>
    {/if}

    <nav class="book-nav" aria-label="Aperture del libro">
      <button
        class="book-arrow"
        onclick={() => (spread = 0)}
        disabled={spread === 0}
        aria-label="Torna al capitolo"
      >
        ←
      </button>
      <div class="book-nav-text">
        <span class="book-page-num">
          {spread === 0 ? "apertura Ⅰ · il capitolo" : "apertura Ⅱ · il bivio"}
        </span>
        <span class="book-hint">
          {#if spread === 0}
            {chapterHint}
          {:else}
            le due strade, una sola scelta
          {/if}
        </span>
      </div>
      <button
        class="book-arrow"
        onclick={() => (spread = 1)}
        disabled={spread === 1 || !chapterReady}
        aria-label="Vai al bivio"
        title={theEnd ? "La storia è finita qui" : !chapterReady ? "Il bivio si apre quando capitolo e tavola sono pronti" : "Apri il bivio"}
      >
        →
      </button>
      {#if prepErr && !busy && !theEnd}
        <button
          class="book-arrow"
          onclick={retryPrep}
          aria-label="Riprova la preparazione"
          title={`Riprova la preparazione (${prepErr})`}
        >
          ↻
        </button>
      {/if}
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

    /* teatro: niente card, tutto schermo, il libro al centro */
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    border: none;
    border-radius: 0;
    padding: 0 0 26px;
    font-family: Georgia, "Times New Roman", serif;
    color: var(--parch);
  }

  .oracle-head {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    width: min(1560px, 98vw);
    margin: 0 auto;
    padding: 14px clamp(8px, 2vw, 24px);
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
    width: min(1560px, 98vw);
    margin: 0 auto;
    padding: 14px clamp(8px, 2vw, 24px) 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  /* ── il libro: copertina + doppia pagina ── */
  .book {
    background:
      linear-gradient(160deg, #3a2b1d 0%, #241a10 55%, #17100a 100%);
    border: 1px solid #4a3823;
    border-radius: 14px;
    padding: 14px;
    box-shadow:
      0 30px 60px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(231, 224, 204, 0.12);
  }

  .fork-head {
    text-align: center;
    font-style: italic;
    color: var(--parch);
    margin: 2px 0 12px;
    font-size: 16px;
    letter-spacing: 0.5px;
  }

  .book-pages {
    display: grid;
    grid-template-columns: 1fr 26px 1fr;
    align-items: stretch;
    background: #efe4c8;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: inset 0 0 0 1px rgba(90, 64, 32, 0.5);
    animation: spread-in 0.45s ease;
  }

  @keyframes spread-in {
    from { opacity: 0; transform: perspective(1400px) rotateX(2deg) translateY(8px); }
    to { opacity: 1; transform: none; }
  }

  .page {
    background:
      radial-gradient(1200px 300px at 50% -10%, rgba(255, 252, 240, 0.9), transparent 60%),
      repeating-linear-gradient(0deg, transparent 0 26px, rgba(120, 90, 50, 0.05) 26px 27px),
      linear-gradient(180deg, #f4ecd4 0%, #ecdfbe 55%, #e2d1a8 100%);
    color: #2c2314;
    padding: 30px 32px 22px;
    /* il libro sta nello schermo: le pagine scorrono dentro, mai la finestra */
    min-height: min(560px, calc(100dvh - 250px));
    max-height: calc(100dvh - 220px);
    overflow-y: auto;
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-x: hidden;
  }

  @media (max-width: 900px) {
    .page { min-height: 0; max-height: none; }
  }

  .page-left { box-shadow: inset -34px 0 34px -28px rgba(74, 52, 24, 0.55); }
  .page-right { box-shadow: inset 34px 0 34px -28px rgba(74, 52, 24, 0.55); }

  .spine {
    background: linear-gradient(90deg, #d8c49a 0%, #a68c5e 18%, #5e4a2d 50%, #a68c5e 82%, #d8c49a 100%);
    position: relative;
  }

  .spine span {
    position: absolute;
    inset: 12px 11px;
    border-left: 2px dashed rgba(62, 44, 22, 0.55);
    display: block;
  }

  @media (max-width: 900px) {
    .book-pages {
      grid-template-columns: 1fr;
    }
    .spine { min-height: 18px; }
    .spine span { inset: 8px 12px; border-left: none; border-top: 2px dashed rgba(62, 44, 22, 0.55); }
    .page { min-height: 0; }
  }

  .page-kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #8a6f45;
    margin: 0 0 8px;
  }

  .page-title {
    margin: 0;
    font-size: 30px;
    line-height: 1.1;
    letter-spacing: 1px;
    color: #241a0d;
    font-variant: small-caps;
  }

  .page-rule { text-align: center; color: #8a6f45; margin: 10px 0 14px; }

  .page-live {
    color: #9a6b2f;
    font-style: italic;
    font-size: 14px;
    margin: 0 0 10px;
  }

  .page-text {
    font-size: 17.5px;
    line-height: 1.85;
    color: #2c2314;
    white-space: pre-wrap;
    flex: 1;
    overflow-wrap: break-word;
    word-break: break-word;
    min-width: 0;
  }

  .page-text::first-letter {
    font-size: 2.6em;
    float: left;
    line-height: 0.9;
    padding-right: 8px;
    color: #6d4d22;
    font-weight: 700;
  }

  .choice-mark {
    margin: 0 0 14px;
    padding: 10px 14px 10px 16px;
    border-left: 3px solid #8e2f26;
    background: rgba(142, 47, 38, 0.08);
    font-style: italic;
    font-size: 15px;
    line-height: 1.6;
    color: #5d231d;
  }

  .the-end {
    text-align: center;
    color: #8a6f45;
    font-size: 15px;
    letter-spacing: 6px;
    margin: 18px 0 4px;
  }

  .past {
    margin-top: 22px;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 18px;
    color: var(--parch-dim);
    font-size: 14px;
  }

  .past summary {
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--parch-dim);
  }

  .past summary:hover { color: var(--ember); }

  .past-num {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--ember);
    margin: 16px 0 6px;
  }

  .past-text {
    margin: 0 0 8px;
    line-height: 1.8;
    white-space: pre-wrap;
    color: var(--parch);
    font-size: 14.5px;
  }

  .folio {
    margin-top: auto;
    padding-top: 20px;
    text-align: center;
    font-size: 12px;
    letter-spacing: 2px;
    color: #8a6f45;
    flex-shrink: 0;
  }

  .rate-row {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    padding-top: 14px;
    flex-shrink: 0;
  }

  .rate-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: 17px;
    line-height: 1;
    padding: 5px 8px;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s, border-color 0.15s, transform 0.15s;
  }

  .rate-btn:hover:not(:disabled) { opacity: 1; transform: translateY(-1px); }
  .rate-btn.on { opacity: 1; border-color: #b89b62; background: rgba(184, 155, 98, 0.15); }
  .rate-btn:disabled { cursor: not-allowed; }

  .plate {
    margin: 6px 0 0;
    border: 1px solid #b89b62;
    background: #fbf5e2;
    padding: 10px 10px 12px;
    box-shadow: 0 14px 30px rgba(74, 52, 24, 0.3);
    max-width: 100%;
    min-width: 0;
  }

  .plate img {
    width: 100%;
    max-width: 100%;
    height: auto;
    display: block;
    aspect-ratio: 1;
    object-fit: cover;
    /* la tavola non deve mai spingere la pagina in overflow: tetto d'altezza
       legato al viewport, il resto lo fa object-fit */
    max-height: min(48dvh, 540px);
    filter: sepia(0.12) contrast(1.02);
  }

  .plate figcaption {
    font-style: italic;
    font-size: 13.5px;
    line-height: 1.5;
    color: #5d4a2c;
    margin-top: 10px;
    overflow-wrap: break-word;
  }

  .plate-placeholder {
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed #b89b62;
    background: rgba(251, 245, 226, 0.6);
    color: #8a6f45;
    font-style: italic;
    font-size: 14px;
  }

  .plate-placeholder p {
    margin: 0;
  }

  /* ── apertura del bivio: le due strade nello stesso libro ── */
  .fork-page {
    text-align: center;
    align-items: center;
  }

  .fork-plate { width: 100%; max-width: 100%; min-width: 0; }

  .fork-label {
    font-size: 17px;
    font-style: italic;
    line-height: 1.6;
    color: #3a2d17;
    margin: 16px 0 20px;
    flex: 1;
    overflow-wrap: break-word;
    word-break: break-word;
    min-width: 0;
  }

  .seal-btn {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #f4ecd4;
    background: linear-gradient(180deg, #8e2f26, #6d211b);
    border: 1px solid #4c140f;
    border-radius: 999px;
    padding: 12px 26px;
    margin-bottom: 4px;
    max-width: 100%;
    cursor: pointer;
    box-shadow: 0 8px 20px rgba(109, 33, 27, 0.4), inset 0 1px 0 rgba(255,255,255,0.25);
    transition: transform 0.15s, filter 0.15s;
    flex-shrink: 0;
  }

  .seal-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
  .seal-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  /* ── navigazione tra le aperture ── */
  .book-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    width: min(1560px, 98vw);
    margin: 16px auto 0;
    padding: 12px clamp(8px, 2vw, 24px) 0;
  }

  .book-page-num {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--parch);
    text-transform: uppercase;
    text-align: center;
  }

  .book-nav-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 280px;
    text-align: center;
  }

  .book-hint {
    font-size: 12.5px;
    font-style: italic;
    color: var(--parch-dim);
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