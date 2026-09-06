# Palamede — Sicurezza

> Postura di sicurezza di Palamede: modello di minaccia, mitigazioni
> implementate, rischi residui accettati e regole di manutenzione. Fonti di
> verità collegate: `README.md` (uso), `SPEC.md` (architettura e contratti
> API), `MAPPA.md` (struttura).

## Modello di minaccia

Palamede gira **tutta in locale** su `127.0.0.1`: la superficie di attacco è
limitata, ma non nulla. Le minacce considerate, in ordine di rilevanza:

| # | Minaccia | Esempio concreto |
|---|---|---|
| 1 | **Drive-by dal browser** | Una pagina web malevola aperta in una scheda chiama le API locali (`http://127.0.0.1:4600`). Le richieste "simple" (POST senza `Content-Type: application/json`, e GET) non fanno preflight CORS, quindi arriverebbero al server. |
| 2 | **DNS rebinding** | Un dominio malevolo risolve su `127.0.0.1`; il browser lo tratta come "stesso sito" e può leggere anche le risposte. |
| 3 | **Catena di fornitura dei modelli** | Un modello scaricato da fonte non ufficiale (o sostituito su disco) può contenere codice malevolo caricato da `torch.load` / eseguito dai runtime C++. |
| 4 | **XSS nella webview Tauri** | Contenuto non escapato renderizzato con `{@html}` darebbe accesso alle API Tauri esposte. |
| 5 | **Abuso da processi locali** | Un altro programma in esecuzione sullo stesso account può chiamare i servizi locali (fuori dal controllo dell'app). |

**Non** fanno parte del modello di minaccia: l'accesso fisico alla macchina,
altri utenti dello stesso sistema con privilegi, attacchi di rete verso la
macchina (i servizi ascoltano solo su loopback).

## Mitigazioni implementate

### Anti drive-by / DNS rebinding (hub `:4600`)

Tutte le richieste al hub passano due guardie in `hub/server.mjs`:

- **`allowedHost`** — l'header `Host` deve essere `127.0.0.1`, `localhost` o
  `::1` (con qualsiasi porta). Il browser invia sempre l'Host richiesto:
  un Host diverso = DNS rebinding → **403**.
- **`allowedOrigin`** — su tutte le route `/api/*`, se l'header `Origin` è
  presente deve essere `http://127.0.0.1:<porta>` / `http://localhost:<porta>`
  (o il dev server Vite `:5173`). Il browser invia l'Origin su ogni fetch e
  su ogni POST: un Origin diverso = richiesta cross-origin da un sito web →
  **403**. L'Origin non è forgiabile da JavaScript di pagina.

I client non-browser (curl, PowerShell, Rust) non inviano Origin e restano
ammessi: sono processi locali già privilegiati.

**Verifica rapida** (hub avviato su porta `4699`):

```powershell
curl -s -o NUL -w "%{http_code}`n" http://127.0.0.1:4699/api/health      # 200
curl -s -o NUL -w "%{http_code}`n" -H "Host: evil.example:4699" http://127.0.0.1:4699/api/health   # 403
curl -s -o NUL -w "%{http_code}`n" -H "Origin: http://evil.example" http://127.0.0.1:4699/api/models # 403
```

### Backend Python (`:8000`, `:8124`) e motori (`:8123`, `:8121`)

- Tutti ascoltano solo su `127.0.0.1` e sono raggiungibili **solo** dal hub
  (gateway unico): il browser non li chiama mai direttamente.
- I body JSON sono validati con **Pydantic** (`GenerateRequest`): model in
  whitelist, `steps`/`width`/`height`/`count`/`strength` limitati, prompt non
  vuoto.
- Nessun `eval`/`exec`/`os.system`/`shell=True` esecutivo; i subprocess
  (sd-server, llama-server) sono lanciati con **array di argomenti**, mai con
  shell.

### Path traversal

Tutti i path costruiti con input utente sono validati con **regex in
whitelist** (`^[a-zA-Z0-9._-]+$` + estensione attesa) e controllo
`startsWith` sulla directory base: `/api/history/img|delete`,
`/api/3d/file`, statici. Nessun `..`/`/` raggiunge `readFile`/`unlink`.

### Catena di fornitura dei modelli

- Download **solo da fonti ufficiali** (HuggingFace ufficiali, repo GitHub
  ufficiali, PyPI, canale PyTorch) — vedi `scripts/setup.ps1`,
  `scripts/copy-models.ps1`, `scripts/setup-trellis.ps1`.
- All'avvio: verifica rapida (dimensione + magic bytes) sui modelli
  `enforce=true` in `experimental/model-antivirus/models.manifest.json` e
  scanner deterministico `scan-models.py --quick`. Se un modello risulta
  alterato → **avvio bloccato**.
- Al download: audit LLM (`audit-model.py`); un file giudicato malevolo viene
  eliminato e l'installazione fallisce.
- A runtime: `torch.load(..., weights_only=True)` (mai deserializzazione
  arbitraria) e `safetensors`/GGUF (formati privi di codice eseguibile).

### App desktop Tauri

- Capability minime in `src-tauri/capabilities/default.json`: `core:default`
  + `notification:default`. **Nessun** plugin shell/fs.
- Un solo comando IPC esposto (`notify`), con titolo/corpo in sola lettura.
- Job Object `KILL_ON_JOB_CLOSE`: se l'app muore, i processi figli vengono
  terminati dal sistema.

### Varie

- Nessun segreto/API key hardcoded nel codice.
- Log di runtime in `outputs/` (gitignored); nessun prompt/loggato dal hub.

## Rischi residui accettati

| Rischio | Impatto | Motivo dell'accettazione |
|---|---|---|
| **CSP `null` nella webview** (`tauri.conf.json`) | Un eventuale XSS in futuro avrebbe accesso alle API Tauri di base | Il rendering HTML è centralizzato in `Markdown.svelte` con escaping su tutto (`esc()`); serve comunque una revisione se si introduce contenuto non escapato. |
| **Trust-on-first-use dei modelli** | Un modello sostituito su disco mantenendo dimensione e magic bytes non viene rilevato all'avvio (che usa `--quick`, senza SHA-256) | Lo SHA-256 su decine di GB all'avvio sarebbe troppo lento; il gate forte è al download (audit LLM). |
| **Probing GET via `<img>`/`<script>`** | Lettura di file con id "non indovinabili" (`outputs/history`, `outputs/3d`) | Gli id sono `timestamp-random` (6 caratteri base36): non enumerabili, e le risposte non sono leggibili cross-origin senza CORS. |
| **Body API senza limite dimensionale** | Un processo locale può riempire RAM/disco (img2img dataUrl, prompt lunghi) | Serve un client locale, già fuori dal modello di minaccia. |
| **Processi figli con i privilegi dell'utente** | Un bug di parsing GGUF nei runtime C++ su file malevolo = esecuzione come utente | La verifica modelli all'avvio è l'unico gate; i modelli vanno scaricati solo da fonti ufficiali. |
| **Knowledge base (RAG)**: endpoint `/api/kb/*` con write su disco | Path traversal / scrittura arbitraria | Tutti i path passano per `kbResolve()` (niente `..`, assoluti, backslash) + whitelist `raw/|wiki/` e `.md/.txt`; `read`/`delete`/`file` con regex + `startsWith` sulla base. |

## Regole di manutenzione

1. **Non rimuovere** le guardie `allowedHost`/`allowedOrigin` in
   `hub/server.mjs`: sono l'unica difesa anti drive-by del hub.
2. Se si cambia la porta del hub o del dev server, aggiornare la allowlist
   di `allowedOrigin` (costante `DEV_ORIGIN_PORT` + `PORT`).
3. Nuovi endpoint `/api/*` con path da input utente: **sempre** regex in
   whitelist + controllo `startsWith` sulla directory base.
4. Nuovi download di modelli: solo fonti ufficiali, poi
   `python experimental/model-antivirus/scan-models.py --update` (solo se i
   file su disco sono attendibili) e audit LLM.
5. `torch.load` su file di terze parti: sempre `weights_only=True`.
6. Se si abilita una CSP in Tauri, testare build + webview prima di
   rilasciare.

## Segnalazione problemi

Problemi di sicurezza (o dubbi sul modello di minaccia): aprire un issue nel
repo o segnalarli nel canale del progetto, includendo la sezione di
`SECURITY.md` coinvolta.