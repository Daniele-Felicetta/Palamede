# Bandersketch

Mini-repo del gioco di generazione di storie, raggiungibile da
`/games` → **Bandersketch** (rotta `/bandersketch`).

## Cos'è

Bandersketch genera una storia breve a partire da un **genere** scelto dal
giocatore, e la illustra con un'immagine generata al volo. Il nome è un
tributo a _Bandersnatch_: come nello speciale interattivo di Netflix, la
storia è diversa ogni volta.

## Come funziona

1. Il giocatore sceglie genere, stile grafico, nome, modello immagini,
   risoluzione tavole e narratore (vedi `src/data.ts` per le opzioni).
   Le scelte sopravvivono in `sessionStorage`: tornando al setup le ritrovi.
2. **Narratore** — llama-server del hub (:8121) col modello scelto nel setup
   (default **Gemma 4 26B-A4B MoE** con visione: GGUF + mmproj in
   `models/gemma-4-26b/`, esperti MoE su RAM con `--cpu-moe` per lasciare la
   VRAM al generatore immagini). Scrive la storia in streaming a capitoli;
   guarda anche le illustrazioni dei capitoli precedenti per mantenere la
   coerenza visiva.
3. **Bivi** — mentre il capitolo scorre, il gioco prepara in background la
   tavola del capitolo e i due sentieri successivi (testo + immagine
   ciascuno, ancorati alla tavola corrente: il bivio descrive ciò che si
   vede). Se la preparazione fallisce (pittore o narratore giù), l'errore
   appare nel libro e si riprova con ↻ — la partita non si blocca più.
4. **Finale** — la partita dura `STORY_LENGTH` capitoli (default 5): l'ultimo
   usa un gancio di chiusura e non apre bivio, la storia finisce con ❦ fine ❦.
5. **Illustrazione** — `generateQuick` (`/api/image`, modello scelto nel
   setup, default Z-Image) genera la tavola dal prompt in `src/data.ts`.
6. **Archivio** — ogni partita salva snapshot su `:4600 /api/stories` (testi,
   scene, seed, tavole PNG): le tavole viaggiano con ogni snapshot finché
   l'archivio non le conferma, e l'ultima scrittura vince (capitolo
   rigenerato = tavola sostituita, mai stale).

## Struttura

```
bandersketch/
├── README.md          ← questo file
└── src/
    ├── Setup.svelte        ← pagina di setup (/bandersketch)
    ├── Bandersketch.svelte ← il gioco (UI + logica)
    ├── session.svelte.ts   ← stato condiviso setup → gioco (+ sessionStorage)
    ├── game.css            ← teatro: stili dedicati fuori dal layout officina
    └── data.ts             ← generi, stili e prompt
```

## Dipendenze

- **Runtime**: hub :4600, server chat :8121 (narratore scelto nel setup:
  default **Gemma 4 26B-A4B**, con visione e mmproj in `models/gemma-4-26b/`;
  alternative Ornith 1.5 9B/35B in `models/`), backend immagini
  (:8000). Il gioco avvia da solo il server chat se non è già attivo con il
  narratore; se il hub non è attivo, il gioco mostra il messaggio d'errore
  nella riga di hint.
- **Import**: riusa componenti dell'app (`ui`, `Shot`) tramite percorsi
  relativi (`../../../` fino a `frontend/src/`).

## Narratore cloud (feature di sviluppo)

Bandersketch può usare **Gemini** (Google AI Studio) come narratore cloud. È
spento di default: senza `PALAMEDE_DEV=1` non compare nell'app. La chiave resta
sul server (hub) e non arriva mai al browser:

1. crea una chiave su <https://aistudio.google.com/apikey>;
2. copia `.env.example` in `.env` alla radice del progetto e imposta sia
   `PALAMEDE_DEV=1` sia `PALAMEDE_GEMINI_API_KEY=…` (oppure usa le variabili
   d'ambiente di sistema);
3. riavvia l'hub: le voci "Gemini …" compaiono nel setup.

Senza flag/chiave il gioco usa i narratori locali (default **Gemma 4 26B**).

## Estendere

- **Nuovo genere**: aggiungi una stringa a `GENRES` in `src/data.ts`
  (il bottone appare da solo).
- **Storia più lunga/corta**: cambia `STORY_LENGTH` in `src/data.ts`.
- **Cambiare l'illustrazione**: modifica `PROMPT` in `src/data.ts`
  (prompt, dimensioni, stile).
- **Logica diversa**: il gioco è in `src/Bandersketch.svelte` (preparazione
  background `firePrep` + `retryPrep`, snapshot archivio `saveSnapshot`).