// Dati della repo Bandersketch: generi, stili grafici e i prompt del narratore.
//
// Filosofia dei prompt (validata sul modello): il narratore (default Gemma 4
// 26B con visione) scrive bene SOLO quando gli si dà un frammento narrativo da
// continuare — mai istruzioni ("scrivi…", "inventa…", "niente…"), che lo
// fanno deragliare in modalità assistente. Il ruolo è fissato dal system
// prompt (NARRATOR_SYSTEM), i messaggi sono solo scene che finiscono con un
// gancio (due punti o una frase sospesa).

export const GENRES = [
  "Fantascienza",
  "Fattoria Comica",
  "Giallo",
  "Horror",
  "Fantasy",
  "Avventura",
];

export interface Style {
  id: string;
  label: string;
  prompt: string; // descrizione visiva, fusa con lo stile bonsai
}

// Stili grafici: la descrizione viene iniettata nel prompt dell'immagine
// insieme a "in stile bonsai".
export const STYLES: Style[] = [
  {
    id: "noir",
    label: "Noir",
    prompt:
      "chiaroscuro da film noir, bianco e nero ad alto contrasto, grana cinematografica, ombre lunghe",
  },
  {
    id: "acquerello",
    label: "Acquerello onirico",
    prompt: "acquerello onirico, velature morbide, luce eterea, bordi sfumati",
  },
  {
    id: "incisione",
    label: "Incisione gotica",
    prompt:
      "incisione gotica, tratteggio incrociato, linee d'inchiostro scure e intricate",
  },
  {
    id: "pixel",
    label: "Pixel art",
    prompt:
      "pixel art retrò, palette limitata, atmosfera da gioco anni novanta",
  },
  {
    id: "sumie",
    label: "Inchiostro cinese",
    prompt:
      "pittura sumi-e, pennellate fluide, vuoti eloquenti, inchiostro nero",
  },
  {
    id: "fumetto",
    label: "Fumetto anni '50",
    prompt:
      "stile fumetto anni cinquanta, inchiostri decisi, retinatura a punti",
  },
];

export function styleById(id: string): Style {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

// Modelli immagini tra cui scegliere all'inizio. Default: z-image.
export const IMAGE_MODELS = [
  { id: "bonsai", label: "Bonsai", hint: "il più veloce" },
  { id: "zimage", label: "Z-Image", hint: "qualità e testo" },
  { id: "klein", label: "Klein", hint: "img2img nativo" },
  { id: "qwenimage", label: "Qwen-Image", hint: "7B · testo, lento" },
] as const;

export const DEFAULT_IMAGE_MODEL = "zimage";

// Risoluzione delle tavole del libro: nel libro occupano ~500px, quindi
// 512² è nitido e velocissimo (bonsai 1.8s, zimage ~3-6s); 768² e 1024²
// solo se vuoi più dettaglio a costo di attesa (zimage 1024² ≈ 17s).
export const IMAGE_SIZES = [
  { id: "512", label: "512²", hint: "veloce · consigliato", w: 512, h: 512 },
  { id: "768", label: "768²", hint: "dettaglio medio", w: 768, h: 768 },
  { id: "1024", label: "1024²", hint: "massimo dettaglio · lento", w: 1024, h: 1024 },
] as const;

export const DEFAULT_IMAGE_SIZE = "512";

export function sizeById(id: string): { w: number; h: number } {
  return IMAGE_SIZES.find((s) => s.id === id) ?? IMAGE_SIZES[0];
}

// Lunghezza della partita: il capitolo STORY_LENGTH è il finale (il narratore
// chiude la storia invece di aprire un nuovo bivio). Storia breve: 5 capitoli.
export const STORY_LENGTH = 5;

// ── narratori: chi racconta la storia (llama-server via hub) ─────────────
// gemma-4-26b è il consigliato: qualità da 30B a ~4.5GB VRAM (--cpu-moe) e
// 36-40 tok/s misurati; ornith-9b l'alternativa leggera stessa-famiglia,
// ornith-35b l'inchiostro pregiato (lento, ~8 tok/s).
export const NARRATOR_MODELS = [
  { id: "gemma-4-26b", label: "Gemma 4 26B", hint: "consigliato · 40 tok/s" },
  { id: "ornith-9b", label: "Ornith 9B", hint: "leggero · stessa famiglia" },
  { id: "ornith-35b", label: "Ornith 35B", hint: "pregiato · ~8 tok/s" },
] as const;

export const DEFAULT_NARRATOR = "gemma-4-26b";

// ── narratori cloud (Gemini via hub /api/narrate, chiave server-side) ─────
// La lista ufficiale arriva da GET /api/narrators; qui gli stessi id per
// etichette e fallback quando l'hub non è raggiungibile dal setup.
export interface CloudNarrator {
  id: string;
  label: string;
  hint: string;
}

export const GEMINI_NARRATORS: CloudNarrator[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", hint: "cloud · gratis" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", hint: "cloud · gratis (riserva)" },
];

export function isGeminiNarrator(id: string): boolean {
  return id.startsWith("gemini-");
}

export function geminiLabel(id: string): string {
  return GEMINI_NARRATORS.find((n) => n.id === id)?.label ?? id;
}

// ── narratore (Gemma 4 26B + mmproj, via llama-server) ────────────────────

// System prompt di ruolo: dice al modello di continuare il testo ricevuto e
// fissa i divieti (fuori scena, elenchi, domande, titoli) SENZA trasformare
// il messaggio in una richiesta.
export const NARRATOR_SYSTEM =
  "Sei il narratore di una storia interattiva. Scrivi la storia in terza " +
  "persona, come un romanzo, continuando il testo che ti viene dato. Mai " +
  "parlare fuori scena, mai elenchi, mai domande al lettore, mai titoli. " +
  "Scene brevi e concrete, una scena per risposta. Ogni azione ha il suo " +
  "personaggio chiamato per nome: mai frasi senza soggetto esplicito.";

// Aperture per genere: 2-3 PREMESSE ciascuna, una sorteggiata a ogni partita.
// La premessa fissa solo situazione e tono con un gancio aperto (":") —
// incidente, oggetti e colpi di scena li inventa il MODELLO, non noi.
// (Un incipit unico e dettagliato rendeva ogni partita uguale: stesso gancio
// → stessa continuazione, la "scheggia nella paglia" di ogni Fattoria.)
// Il tono sta nella premessa: per la Fattoria, rapporti comici con Pasticcia
// e soci — il system prompt ("atmosferiche") da solo vira all'horror.
const OPENINGS: Record<string, string[]> = {
  Fantascienza: [
    "{name} guardò il cielo viola sopra la città, dove le stelle non erano più al loro posto. Poi notò qualcosa che non avrebbe dovuto esserci:",
    "La colonia su Marte di {name} riceveva rifornimenti ogni sei mesi, ma l'ultima navetta aveva scaricato una cassa senza mittente che respirava. Sull'etichetta c'era scritto:",
  ],
  "Fattoria Comica": [
    "{name} e la mucca Pasticcia avevano un rapporto complicato, fatto di ripicche quotidiane. Quella mattina, Pasticcia aveva decisamente esagerato:",
    "Nella fattoria di {name} gli animali avevano preso strane abitudini: il gallo Napoleone teneva assemblee, le galline scioperavano. Quella mattina la situazione era precipitata perché:",
    "{name} doveva mungere Pasticcia davanti all'ispettore sanitario venuto per il controllo annuale, e la mucca — che fiutava la paura come i cani — aveva scelto proprio quel momento per dichiarare guerra. Quando l'ispettore aprì il taccuino, Pasticcia fece:",
  ],
  Giallo: [
    "La pioggia cadeva sulla città mentre {name} attraversava la piazza deserta. In fondo al vicolo, una porta era socchiusa e da dentro filtrava una luce mai vista:",
    "{name} faceva l'investigatore privato da tre anni senza un caso decente, finché una cliente entrò con la fotografia del marito in due posti diversi alla stessa ora. Sul retro della foto, una scritta diceva:",
  ],
  Horror: [
    "La casa in fondo alla strada non era mai stata abitata, o almeno così dicevano. Quella notte, dalla finestra del piano di sopra, {name} vide una sagoma ferma che lo guardava:",
    "{name} aveva affittato la casa in fondo alla strada perché costava poco, e il prezzo basso aveva un motivo che scoprì la prima notte, quando tutti gli orologi si fermarono alle tre e dal piano di sopra scese un suono di:",
  ],
  Fantasy: [
    "{name} seguiva il sentiero di pietre chiare attraverso il bosco antico quando, al limitare degli alberi, apparve una luce che non aveva mai visto prima:",
    "{name} non credeva alle voci sulla torre in rovina oltre il fiume, finché non vide le sue finestre accendersi tutte insieme, una per una, come se qualcosa stesse salendo le scale. Sulla porta, scritto col gesso, c'era:",
  ],
  Avventura: [
    "La mappa diceva che il tesoro era sotto l'isola, ma nessuno era mai tornato per raccontarlo. {name} accese la torcia e scese nella galleria; in fondo, una luce tremolava:",
    "{name} aveva comprato all'asta il baule di un esploratore scomparso: mappe, bussole rotte e un diario con l'ultima pagina strappata. Sotto il doppiofondo, avvolto in un panno unto, c'era:",
  ],
};

export function chapter1Fragment(genre: string, name: string): string {
  const seeds =
    OPENINGS[genre] ??
    ["{name} stava vivendo una giornata qualunque quando accadde qualcosa di strano:"];
  const seed = seeds[Math.floor(Math.random() * seeds.length)];
  return seed.split("{name}").join(name);
}

// Capitolo successivo: coda della storia + intera scena scelta dal giocatore
// + gancio di CONSEGUENZA. Va passata la scena INTERA del bivio (non la sola
// etichetta): prima si teneva solo la prima frase e il resto andava perso,
// spezzando la continuità tra scelta e nuovo capitolo. Il gancio "non tornò
// indietro" costringe il narratore a dare peso alla scelta: il protagonista
// la assume fino in fondo, mai continuazione neutra che la ignora.
export function nextChapterFragment(
  tail: string,
  chosenFull: string,
  name: string,
): string {
  return `${tail}\n\n${chosenFull}\n\n${name} non tornò indietro: `;
}

// Ultimo capitolo: coda della storia + intera scena scelta + gancio di
// CHIUSURA. Stessa forma di nextChapterFragment, ma il gancio invita a
// concludere ("l'ultima cosa… prima della fine") invece di rilanciare:
// dopo questo capitolo non si apre nessun bivio, la partita finisce.
export function finaleFragment(
  tail: string,
  chosenFull: string,
  name: string,
): string {
  return `${tail}\n\n${chosenFull}\n\n${name} non tornò indietro, e quella fu l'ultima cosa che fece prima della fine: `;
}

// Sentiero A: il protagonista passa all'azione. Il gancio chiude su nome +
// verbo ("decise di agire:"), così il modello completa con un'AZIONE concreta
// dal soggetto chiaro — il bivio è una scelta, non un'osservazione (il vecchio
// "notò" produceva contemplazioni passive e soggetti vaghi).
export function branchAFragment(tail: string, name: string): string {
  return `${tail}\n\n${name} decise di agire subito: `;
}

// Sentiero B: la via alternativa — il protagonista temporeggia e studia la
// situazione. Stessa forma di A (decisione esplicita, soggetto chiaro): le
// due opzioni sono due strade vere, non due modi di guardare la stessa scena.
export function branchBFragment(tail: string, name: string): string {
  return `${tail}\n\n${name} invece decise di aspettare e capire: `;
}

// Prima frase di un testo: usata per l'etichetta del sentiero e per il
// prompt dell'immagine del capitolo (scena pulita senza resto della prosa).
// Ignora i punti delle abbreviazioni (sig., dott., ecc.) e i puntini di
// sospensione: la frase finisce solo su . ! ? … seguiti da spazio+maiuscola
// (o fine testo).
const ABBREV = new Set([
  "sig", "sig.ra", "dott", "dott.ssa", "prof", "prof.ssa", "avv", "ing",
  "rag", "geom", "cav", "sr", "s.", "e.g", "ecc", "vs", "n", "pag", "cap",
  "art", "lett", "fig", "tel", "cell",
]);

export function firstSentence(text: string): string {
  const t = text.trim();
  // Candidati: ogni . ! ? … (singolo o in serie) con eventuale virgoletta di chiusura.
  const re = /([.!?…]+)(["»”']?)(\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const punct = m[1];
    // Puntini di sospensione a metà frase: non sono una fine.
    if (punct.length >= 2 && m[3].trim() === "" && m.index + m[0].length < t.length) continue;
    // Abbreviazione? (parola prima del punto, es. "sig." / "A."). Le iniziali
    // singole (una lettera) sono quasi sempre abbreviazioni.
    const before = t.slice(0, m.index);
    const word = /([A-Za-zÀ-ÿ]+\.?)$/.exec(before)?.[1] ?? "";
    const bare = word.replace(/\.+$/, "").toLowerCase();
    if (word && (ABBREV.has(bare) || bare.length === 1)) continue;
    // Fine vera solo se dopo c'è maiuscola / numero / caporale — o fine testo.
    const after = t.slice(m.index + m[0].length);
    if (after === "" || /^["«“'(\[]?[A-ZÀ-Þ0-9]/.test(after)) {
      return t.slice(0, m.index + m[1].length + m[2].length).trim();
    }
  }
  return t;
}

// Coda di contesto per i frammenti di bivio: gli ultimi ~max caratteri ma
// tagliati al confine di frase, mai a metà parola. Un taglio cieco lascia un
// moncone ("...come un pensiero colpevole che") e il narratore deraglia,
// inventando elementi scollegati (test live su Ornith: moglie/scale mai citate).
export function tailContext(full: string, max = 900): string {
  if (full.length <= max) return full;
  const cut = full.slice(-max);
  // Ultimo confine di frase solido nella seconda metà del ritaglio.
  const bounds = [...cut.matchAll(/[.!?…]["»”']?\s+/g)].map((x) => x.index + x[0].length);
  const good = bounds.filter((i) => i > max * 0.3);
  if (good.length) return cut.slice(good[good.length - 1]).trimStart();
  // Ripiego: evita almeno il taglio a metà parola.
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.5) return cut.slice(sp + 1).trimStart();
  return cut;
}

// Il modello riecheggia spesso il gancio in testa ("In quel momento, Kael
// notò un'ombra…"): toglie dall'output l'eco dell'ultima riga del frammento.
// Confronta a parole (minuscole, senza punteggiatura) e toglie la sequenza
// iniziale più lunga che combacia con la coda del frammento (min 2 parole).
// La vecchia versione confrontava dalla TESTA del frammento (900 caratteri
// di storia) e non scattava mai.
export function stripEcho(out: string, fragment: string): string {
  const norm = (w: string) => w.toLowerCase().replace(/^[^a-zà-ÿ0-9]+|[^a-zà-ÿ0-9]+$/g, "");
  const tailWords = fragment.split(/\s+/).map(norm).filter(Boolean).slice(-40);
  const outWords = out.trimStart().split(/\s+/);
  const normOut = outWords.map(norm);
  const maxK = Math.min(12, normOut.length, tailWords.length);
  // Min 2 parole: l'eco è tale solo se combacia letteralmente con la coda
  // del frammento — un attacco genuino non ripete mai quelle parole.
  for (let k = maxK; k >= 2; k--) {
    const head = normOut.slice(0, k).join(" ");
    // L'eco deve chiudere il frammento: confronta con la coda.
    if (head && head === tailWords.slice(-k).join(" ")) {
      return outWords.slice(k).join(" ").trimStart();
    }
  }
  return out.trimStart();
}

// Etichetta del sentiero per il libro: prima frase con iniziale maiuscola.
// Il bivio continua il gancio ("notò che…"), quindi la frase nasce spesso
// minuscola ("che la superficie…"): nel libro sembrerebbe un refuso.
export function branchLabel(text: string, fallback: string): string {
  const s = firstSentence(text) || fallback;
  const i = [...s].findIndex((ch) => /[A-Za-zÀ-ÿ]/.test(ch));
  if (i < 0) return s;
  return s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
}

// Soggetto visivo per il pittore: le prime DUE frasi della scena, non una.
// Una sola frase è spesso atmosferica ma non visiva ("Che l'ombra non si
// limitava a scivolare…"); con due il soggetto si ancora (ombra + pavimento).
export function sceneSnippet(text: string, max = 320): string {
  const t = text.trim();
  const re = /([.!?…]+)(["»”']?)(\s+|$)/g;
  let m: RegExpExecArray | null;
  let count = 0;
  let end = t.length;
  while ((m = re.exec(t)) !== null) {
    const after = t.slice(m.index + m[0].length);
    if (after === "" || /^["«“'(\[]?[A-ZÀ-Þ0-9]/.test(after)) {
      count++;
      end = m.index + m[1].length + m[2].length;
      if (count >= 2) break;
    }
  }
  const out = t.slice(0, end).trim();
  return out.length > max ? out.slice(0, max).trimEnd() : out;
}

// ── ancora semantica dei bivi ────────────────────────────────────────────
// Il bivio deve CONTINUARE la scena, non inventarne una nuova ("sfera
// intrecciata", "capanna" al posto di "stalla", "filamenti dorati" dal nulla).
// Estrae dalla coda le parole-ancora (sostantivi distintivi: lunghi, non
// funzionali) e verifica che il bivio ne riusi almeno `min`: in caso
// contrario il gioco rigenera una volta a temperatura bassa.

// Parole funzionali italiane (minuscole, senza accenti): mai ancore.
const IT_STOP = new Set(
  (
    "che con come sono era erano delle nella sulle sullo questo questa questi queste quello quella quelli quelle " +
    "molto tanto mentre quando dove quale quali senza sopra sotto dietro davanti ancora anche allora quindi perche " +
    "poiche infatti tutta tutto tutti tutte ogni altro altra altri altre stato stata stati state aveva hanno abbia " +
    "siamo siete posso vuole devo fanno detto fatto volta modo parte attimo essere fare dire cosa cose niente nulla " +
    "sempre mai gia poi qui qua li ne ci si mio mia miei mie tuo tua tuoi tue suo sua suoi sue nostro nostra vostro " +
    "vostra loro un una uno due tre il lo la gli dei delle della degli dello alla allo dal dallo dalla dallo nel " +
    "nello nella nelle negli sugli sul sullo sulla sullo col coi dai dallo dalla dallo quanto ben male poco troppo " +
    "stesso stessa quasi queste quello quelli tutte " +
    "tutti fui foste sara sarai abbiamo avete hai"
  ).split(/\s+/),
);

const ascii = (w: string): string =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, " ") // l'oggetto → "l oggetto": l'articolo non incolla i temi
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const stemIt = (w: string): string => {
  const a = ascii(w).replace(/(hi|ghi)$/, "X");
  return a.replace(/[aeiou]+$/, "");
};

// Tokenizza sciogliendo gli apostrofi ("l'ombra" → "l" + "ombra").
const tokens = (text: string): string[] =>
  text.split(/\s+/).flatMap((t) => ascii(t).split(" ")).filter(Boolean);

// Le parole-ancora della scena: TUTTI i temi lunghi (≥5) non funzionali, in
// ordine di comparsa. Niente campionamento: il punteggio confronta su tutta
// la scena, i confronti sono pochi e costano nulla. (Il campionamento
// perdeva proprio le parole decisive: "scheggia" fuori dai 24.)
export function anchors(tail: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of tokens(tail)) {
    if (w.length < 5 || IT_STOP.has(w)) continue;
    const s = stemIt(w);
    if (s.length < 4 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Quante ancore della scena riusa il bivio (confronto per radice: singolare/
// plurale e alterazioni semplici combaciano).
export function groundingScore(branch: string, tail: string): number {
  const a = anchors(tail);
  if (!a.length) return 99; // scena senza ancore: non giudicabile, passa
  const bw = new Set(tokens(branch).map(stemIt).filter((s) => s.length >= 4));
  let hit = 0;
  for (const s of a) if (bw.has(s)) hit++;
  return hit;
}

// true se il bivio continua davvero la scena (default: almeno 4 ancore).
// Soglia severa di proposito: un falso positivo costa solo una rigenerazione
// in background, un bivio inventato ("capanna/filamenti" dal nulla) rovina la
// partita. Se anche il retry resta sotto soglia si tiene il testo migliore.
export function groundedIn(branch: string, tail: string, min = 4): boolean {
  return groundingScore(branch, tail) >= min;
}

// Il modello a volte ignora il gancio e ricopia la coda ("Gino rimase
// immobile…" già letto nel capitolo): il controllo ancore non lo becca
// perché la ripetizione riusa le parole-chiave. Vero se la prima frase del
// bivio (o il suo attacco) è già nella scena.
export function repeatsTail(branch: string, tail: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  const b = norm(branch);
  const t = norm(tail);
  if (!b || !t) return false;
  const first = norm(firstSentence(branch));
  if (first.length >= 25 && t.includes(first)) return true;
  if (b.length >= 60 && t.includes(b.slice(0, 60))) return true;
  return false;
}

// Prompt finale per l'immagine: scena + stile grafico scelto + estetica bonsai.
export function imagePrompt(scene: string, style: Style): string {
  return `${scene}, ${style.prompt}, in stile bonsai, dettagli evocativi, atmosfera enigmatica`;
}