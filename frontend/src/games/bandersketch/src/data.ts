// Dati della repo Bandersketch: generi, stili grafici e i prompt del narratore.
//
// Filosofia dei prompt (validata sul modello): il narratore (Ornith-9B con
// visione) scrive bene SOLO quando gli si dà un frammento narrativo da
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
] as const;

export const DEFAULT_IMAGE_MODEL = "zimage";

// ── narratore (Ornith-9B + mmproj, via llama-server) ──────────────────────

// System prompt di ruolo: dice al modello di continuare il testo ricevuto e
// fissa i divieti (fuori scena, elenchi, domande, titoli) SENZA trasformare
// il messaggio in una richiesta.
export const NARRATOR_SYSTEM =
  "Sei il narratore di una storia interattiva. Scrivi la storia in terza " +
  "persona, come un romanzo, continuando il testo che ti viene dato. Mai " +
  "parlare fuori scena, mai elenchi, mai domande al lettore, mai titoli. " +
  "Scene brevi e atmosferiche, una scena per risposta.";

// Aperture per genere: frammenti che terminano con un gancio (il modello
// continua da lì). Il nome del protagonista è segnato con {name}.
const OPENINGS: Record<string, string> = {
  Fantascienza:
    "{name} guardò il cielo viola sopra la città, dove le stelle non erano più al loro posto. Poi notò qualcosa che non avrebbe dovuto esserci:",
  "Fattoria Comica":
    "{name} stava mungendo la mucca Pasticcia quando la stalla si zittì di colpo. Tra il fieno, qualcosa brillava:",
  Giallo:
    "La pioggia cadeva sulla città mentre {name} attraversava la piazza deserta. In fondo al vicolo, una porta era socchiusa e da dentro filtrava una luce mai vista:",
  Horror:
    "La casa in fondo alla strada non era mai stata abitata, o almeno così dicevano. Quella notte, dalla finestra del piano di sopra, {name} vide una sagoma ferma che lo guardava:",
  Fantasy:
    "{name} seguiva il sentiero di pietre chiare attraverso il bosco antico quando, al limitare degli alberi, apparve una luce che non aveva mai visto prima:",
  Avventura:
    "La mappa diceva che il tesoro era sotto l'isola, ma nessuno era mai tornato per raccontarlo. {name} accese la torcia e scese nella galleria; in fondo, una luce tremolava:",
};

export function chapter1Fragment(genre: string, name: string): string {
  const seed =
    OPENINGS[genre] ??
    "{name} stava vivendo una giornata qualunque quando accadde qualcosa di strano:";
  return seed.split("{name}").join(name);
}

// Capitolo successivo: storia finora + direzione scelta dal giocatore + gancio.
export function nextChapterFragment(
  fullStory: string,
  direction: string,
  name: string,
): string {
  return `${fullStory}\n\n${direction}\n\n${name} mosse un passo, e in quel momento `;
}

// Sentiero A: un nuovo dettaglio che il protagonista nota davanti a sé.
export function branchAFragment(tail: string, name: string): string {
  return `${tail}\n\nIn quel momento, ${name} notò `;
}

// Sentiero B: qualcosa si muove alle spalle del protagonista (alternativa
// visiva e misteriosa, senza ripetere il frammento di A).
export function branchBFragment(tail: string, name: string): string {
  return `${tail}\n\nInvece, alle spalle di ${name}, qualcosa si mosse: `;
}

// Prima frase di un testo: usata per l'etichetta del sentiero e per il
// prompt dell'immagine del capitolo (scena pulita senza resto della prosa).
export function firstSentence(text: string): string {
  const m = /^[^.!?]*[.!?]/.exec(text.trim());
  return (m ? m[0] : text.trim()).trim();
}

// Prompt finale per l'immagine: scena + stile grafico scelto + estetica bonsai.
export function imagePrompt(scene: string, style: Style): string {
  return `${scene}, ${style.prompt}, in stile bonsai, dettagli evocativi, atmosfera enigmatica`;
}