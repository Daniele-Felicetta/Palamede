# Bandersketch

Mini-repo del gioco di generazione di storie, raggiungibile da
`/games` → **BanderSketch** (rotta `/bandersketch`).

## Cos'è

Bandersketch genera una storia breve a partire da un **genere** scelto dal
giocatore, e la illustra con un'immagine generata al volo. Il nome è un
tributo a _Bandersnatch_: come nello speciale interattivo di Netflix, la
storia è diversa ogni volta.

## Come funziona

1. Il giocatore sceglie un genere tra 6 bottoni (vedi `src/data.ts`).
2. **Narratore** — llama-server del hub (:8121) col modello **Ornith 1.5
   35B-A3B** con visione (GGUF + mmproj in `models/ornith-1.5-35b/`). Gli
   esperti MoE girano su RAM (`--cpu-moe`) per lasciare la VRAM al generatore
   immagini. Scrive una storia breve con ambientazione, personaggi e colpo di
   scena finale; i token arrivano in streaming e si compongono a schermo.
   Guarda anche le illustrazioni dei capitoli precedenti per mantenere la
   coerenza visiva.
3. **Illustrazione** — `generateQuick` (`/api/image`, modello scelto nel
   setup, default Z-Image) genera un'immagine 1024×1024 dal prompt in
   `src/data.ts`, mostrata sotto la storia con la scheda `Shot`.

## Struttura

```
bandersketch/
├── README.md          ← questo file
└── src/
    ├── Setup.svelte        ← pagina di setup (/bandersketch)
    ├── Bandersketch.svelte ← il gioco (UI + logica)
    ├── session.svelte.ts   ← stato condiviso setup → gioco
    └── data.ts             ← generi, stili e prompt
```

## Dipendenze

- **Runtime**: hub :4600, server chat :8121 (Ornith 1.5 35B-A3B con visione,
  esperti MoE su RAM, GGUF in `models/ornith-1.5-35b/`), backend immagini
  (:8000). Il gioco avvia da solo il server chat se non è già attivo con il
  narratore; se il hub non è attivo, il gioco mostra il messaggio d'errore
  nella riga di hint.
- **Import**: riusa componenti dell'app (`ui`, `Shot`) tramite percorsi
  relativi (`../../../` fino a `frontend/src/`).

## Estendere

- **Nuovo genere**: aggiungi una stringa a `GENRES` in `src/data.ts`
  (il bottone appare da solo).
- **Cambiare l'illustrazione**: modifica `PROMPT` in `src/data.ts`
  (prompt, dimensioni, stile).
- **Logica diversa**: tutto il gioco è in `src/Bandersketch.svelte`
  (90 righe circa).