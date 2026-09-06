// Stato condiviso tra la pagina di setup (Setup.svelte) e la pagina di gioco
// (Bandersketch.svelte, rotta /bandersnatch/[genere]). Setup scrive qui i
// parametri della partita; il gioco li legge. Un accesso diretto al gioco
// senza passare dal setup ricade sui default della pagina di gioco.
export const gameSession = $state<{
  genre: string;
  style: string;
  name: string;
  model: string;
}>({
  genre: "",
  style: "",
  name: "",
  model: "",
});
