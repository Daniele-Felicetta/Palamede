// Stato condiviso tra la pagina di setup (Setup.svelte) e la pagina di gioco
// (Bandersketch.svelte, rotta /bandersketch/[genere]). Setup scrive qui i
// parametri della partita; il gioco li legge. Un accesso diretto al gioco
// senza passare dal setup ricade sui default della pagina di gioco.
//
// La sessione vive anche in sessionStorage: un reload a metà partita (o
// l'apertura diretta del link) non deve più azzerare nome/genere/stile
// facendo ricadere il protagonista su "Viandante".
const KEY = "bandersketch-session";

interface Session {
  genre: string;
  style: string;
  name: string;
  model: string;
  narrator: string;
  size: string;
}

const BLANK: Session = {
  genre: "",
  style: "",
  name: "",
  model: "",
  narrator: "",
  size: "",
};

function load(): Session {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { ...BLANK, ...(JSON.parse(raw) as Partial<Session>) };
  } catch {
    /* storage non disponibile */
  }
  return { ...BLANK };
}

export const gameSession = $state<Session>(load());

export function saveSession(): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(gameSession));
  } catch {
    /* storage non disponibile */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage non disponibile */
  }
}
