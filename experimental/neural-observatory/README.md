# Osservatorio neurale — LFM2.5 230M

Laboratorio sperimentale per guardare e modificare **in tempo reale** un LLM
piccolo. Si dà un esempio, il modello fa uno o due optimizer step, e la scena
3D mostra che cosa è cambiato nei pesi — non un'animazione, ma i numeri che
il backend ha letto dai tensori del checkpoint.

```
   un esempio  →  forward  →  loss  →  backward  →  optimizer step
                                                              │
                                    parametri, gradienti, delta, attivazioni
                                                              │
                                                        scena 3D + inspector
```

## Il principio: niente dati inventati

Ogni numero della pagina è una misura. Se una misura non è disponibile o
costerebbe troppo, l'interfaccia **lo dice** invece di riempirlo con uno zero
che sembrerebbe una lettura. I tre esempi concreti, tutti verificati dai test:

| Situazione | Cosa fa l'osservatorio |
|---|---|
| `precision: bf16` | 32 tensori su 132 ricevono gradiente ma il delta si **azzera**: l'update (~1e-5) sta sotto la risoluzione bf16 (~0.0039 per valori vicini a 1). Sono tutti RMSNorm. Il payload porta `rounded_away_tensors: 32` e una nota che dice perché. |
| Modalità LoRa | Embeddings e LM Head sono congelati: le loro righe restano nella tabella con `measured: false` e `delta_norm: 0`, invece di sparire e far sembrare la rete più piccola. |
| Cronologia senza copie dei pesi | Il confronto A vs B lavora su perdita, delta per layer e output; la distanza parametrica vera si calcola solo se `weight_snapshot_keep > 0`, e il pannello dice quale dei due casi è. |

## Cosa NON è la visualizzazione

> Ogni nodo è un **gruppo di tensori di parametri** (una matrice di peso o un
> vettore di normalizzazione), **non un neurone**. La dimensione del nodo
> rappresenta il numero di parametri del gruppo. 229 milioni di parametri
> disegnati neurone-per-neurone sarebbero illeggibili e fuori dal budget di
> un frame.

Il disclaimer è generato dal backend (`DISCLAIMER` in `server.py`) e mostrato
dalla pagina, così non può divergere da quello che la scena fa davvero.

## L'architettura reale di LFM2.5 (non è Llama)

Il checkpoint è **ibrido**: 14 blocchi che alternano due operazioni diverse.
Questo è letto da `config.layer_types`, non dedotto da un template.

```
  blocchi pari  (0 1 3 5 7 9 11 13)  →  SHORT CONV   (stile Mamba)
                                        conv.in_proj · conv.conv · conv.out_proj
                                        nessuna attenzione
  blocchi dispari (2 4 6 8 10 12)     →  FULL ATTENTION  GQA 16 q / 8 kv, head_dim 64
                                        q_proj · k_proj · v_proj · out_proj
                                        q_layernorm · k_layernorm
  tutti e 14                          →  MLP SwiGLU  w1=gate · w3=up · w2=down
                                        operator_norm · ffn_norm
  testa e piede                       →  embed_tokens (65536×1024, lm_head TIED)
                                        embedding_norm
```

`d_model` 1024 · `ffn` 2560 · vocab 65536 · `norm_eps` 1e-5 · rope θ 1e6 ·
`conv_L_cache` 3 (kernel 4) · contesto 128000 · tokenizer gpt2-BPE con
pretokenizer `pre=lfm2` (bos=1, eos=7, pad=0).

**Parametri misurati: 229.693.184** — che è il "230M" del nome. La trappola:
`transformers` di default riscrive `intermediate_size` a 1792
(`block_auto_adjust_ff_dim`) e il modello scende a **195,6M**. Per ottenere i
229,7M reali servono `intermediate_size=2560` **e**
`block_auto_adjust_ff_dim=False`. Il test `t_param_count` verifica la cifra
esatta, non una stima.

Il nodo **LM Head è un alias** di Embeddings: in questo checkpoint
`lm_head.weight` e `embed_tokens.weight` sono lo stesso tensor. Resta visibile
come la specifica chiede, ma è marcato `params_aliased` e non viene contato
due volte nel totale dell'update.

## Perché PyTorch e non LM Studio

LM Studio (e la sua API OpenAI-compatible su `:1234`) fa **solo inferenza**.
Non esiste modo di scrivere i pesi via HTTP, e i checkpoint che distribuisce
sono GGUF quantizzati, che PyTorch non può addestrare. La separazione è netta:

```
   LM Studio  →  inference        (come il resto di Palamede)
   PyTorch    →  training         (questo progetto, in processo)
```

Il progetto non manda richieste HTTP per fare fine-tuning.

## Precisione: perché `mixed` e non `bf16`

`precision: mixed` tiene i **pesi master in fp32** e fa il calcolo sotto
`autocast(bf16)`. Con pesi in bf16 puro:

```
  132 tensori trainabili
   33 invariati dopo 3 step  ← tutti RMSNorm
   lr × Adam ≈ 1e-5, su un valore vicino a 1.0
   risoluzione bf16 = 2^-8 ≈ 0.0039   →  arrotonda a zero
```

Non è un gradiente nullo: è un update che il formato non sa rappresentare. Un
osservatorio che dichiara un delta che il peso non ha ricevuto mente per
costruzione, quindi il default è fp32 master. Costo misurato: **89,6 ms/step
contro 58,8** — e `0/132` delta persi contro `33/132`.

`bf16` resta selezionabile per la latenza, con l'avvertenza esplicita.

## Prestazioni misurate

RTX 5060 Ti (16,3 GB), torch 2.9.1+cu130, transformers 5.16.1, batch 1:

| Cosa | Tempo |
|---|---|
| caricamento pesi + warmup CUDA | 0,8 – 2,2 s |
| **prima generazione dopo il warmup** | **~220 ms / 8 token** (≈ 36 tok/s) |
| prima generazione **senza** warmup | fino a **13.650 ms** |
| forward (seq 10) | 14 – 44 ms |
| backward | 20 – 64 ms |
| optimizer step | 3 ms |
| analisi dei 132 tensori | 85 – 250 ms |
| update completo (2 step, con BEFORE+AFTER) | ~1.000 ms |
| VRAM picco, FULL fp32 master | 5,3 GB |
| VRAM picco, LoRa r=8 | 1,0 GB |

Il warmup esiste per quello: senza, la prima richiesta dell'utente paga
13,6 secondi di inizializzazione kernel. `ModelHost.warmup()` scatta quei
kernel e poi **ripristina i pesi**, così il modello torna esattamente quello
appena caricato.

L'analisi dei delta è più costosa dell'optimizer step: è il prezzo della
misura onesta su 229 milioni di parametri, ed è dichiarata in
`StepTiming.analyze_ms` per non confonderla con il costo del training.

## LoRa scritto a mano

`peft` non è nel venv che gira l'osservatorio e la rete di lavoro non permette
di installarlo (certificato TLS intercettato: ogni `pip install` fallisce con
`SSLCertVerificationError`). Un adapter LoRa sono due matrici, e `lora.py` le
scrive: `A` (rank × in) a Kaiming, `B` (out × rank) a **zero**, base congelata,
scala `alpha/rank`.

Vantaggio per un osservatorio: `A` e `B` sono tensori normali, con nome,
forma e gradiente, e l'analizzatore li misura come qualunque altro parametro.
`B` che esce da zero è verificato dai test (`t_lora_train`).

Configurabili: `rank`, `alpha`, `dropout`, `target_modules` — validati contro
i nomi **reali** del checkpoint, con i target inesistenti dichiarati nella
risposta (`missing_targets`) invece di ignorati.

## Il trasporto: SSE, non WebSocket

Il progetto chiedeva WebSocket. Qui non è possibile, e il motivo è preciso:

```
  WARNING:  No supported WebSocket library detected. Please use
            "pip install 'uvicorn[standard]'", or install 'websockets' or
            'wsproto' manually.
```

uvicorn 0.52 implementa l'handshake WebSocket solo se trova `websockets` o
`wsproto`; nel venv (`reference/trellis-venv`) non ci sono, e non si possono
installare. Mettere su un secondo server WebSocket scritto a mano avrebbe
duplicato lo stesso canale due volte.

Quindi: **eventi giù** su `GET /api/stream` (`text/event-stream`), **comandi
sù** sui POST. Ogni evento porta `id:` monotono e `event:` col tipo; il
browser rimanda `Last-Event-ID` reconnectando, e il backend recapita gli
eventi persi. È lo stesso trasporto che questo repo usa già per lo streaming
del chat, quindi l'hub lo inoltra senza codice nuovo.

## Struttura

```
experimental/neural-observatory/
  backend/
    config.py     cosa si puo' cambiare, con validazione (un solo JSON)
    graph.py      topologia 3D derivata dal checkpoint: 16 nodi, 130 moduli
    model.py      caricamento, precisione, LoRa, attivazioni, warmup
    lora.py       LoRa a mano (zero dipendenze)
    trainer.py    il ciclo di un esempio: BEFORE → step → AFTER
    analyzer.py   statistiche per tensore/modulo/layer + cronologia
    metrics.py    cronometro CUDA, VRAM, token/s
    server.py     FastAPI + stream SSE (porta 8131)
  configs/default.json
  experiments/esempi.json
  scripts/        (le copie operative stanno in scripts/ del repo)
  tests/
    test_observatory.py  20 verifiche sul checkpoint reale
    test_server.py       39 verifiche REST + SSE
    test_e2e.py          16 verifiche attraverso l'hub
```

Frontend dentro l'app esistente (non una seconda app): `frontend/src/pages/
Observatory.svelte` + `frontend/src/lib/observatory/` + `styles/observatory.css`.
È lazy come le altre pagine: **26 kB gzip**, e `three` resta in un chunk
separato che si scarica solo aprendo `/3d` o `/observatory`.

## Uso

```powershell
.\scripts\setup-observatory.ps1          # verifica i prerequisiti
.\scripts\start-observatory.ps1 -Load    # avvia e carica i pesi
```

Poi apri **Osservatorio** dalla pagina Extra (o `#/observatory`).

Dall'app l'hub può avviarlo anche da solo: `GET /api/observatory/start`.

## Test

```powershell
# 20 verifiche: modello, grafo, training, LoRa, storia, precisione
reference\trellis-venv\Scripts\python.exe experimental\neural-observatory\tests\test_observatory.py

# 39 verifiche: server vero su :8131, REST + stream SSE
reference\trellis-venv\Scripts\python.exe experimental\neural-observatory\tests\test_server.py

# 16 verifiche: attraverso l'hub, il percorso che fa il browser
reference\trellis-venv\Scripts\python.exe experimental\neural-observatory\tests\test_e2e.py
```

Nessun mock: ogni assertion passa attraverso i 229.693.184 parametri reali,
un forward, un backward e un optimizer step.

## Cosa non è verificato

Il rendering WebGL in un browser vero. I test coprono il percorso dei dati
(fino al payload che il frontend riceve, attraverso l'hub) e `svelte-check` +
`vite build` coprono la compilazione, ma **nessun test in questo repository
esegue un browser**: la scena 3D va guardata aprendo la pagina.
