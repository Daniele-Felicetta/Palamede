<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    generate3D,
    start3D,
    stop3D,
    type Generate3DResult,
  } from "../api";
  import { store } from "../store.svelte";
  import { Images } from "../lib/images";
  import { dataUrlToBytes, downloadUrl } from "../lib/download";
  import { createViewer3D, type Viewer3D } from "../lib/viewer3d";
  import {
    Button,
    ChatState,
    Dropzone,
    EmptyState,
    Eyebrow,
    Field,
    Hintline,
    HistHead,
    Panel,
  } from "../components/ui";

  let img = $state<string | null>(null);
  let pipelineType = $state("512");
  let seed = $state(-1);
  let busy = $state(false);
  let hint = $state("");
  let error = $state(false);
  // Stato del server 3D: dallo store condiviso (unico poller dell'app).
  const server = $derived(store.trellis);
  let serverBusy = $state(false);
  let result = $state<Generate3DResult | null>(null);
  let viewerErr = $state("");

  let canvas: HTMLCanvasElement | null = $state(null);
  let viewer: Viewer3D | null = $state(null);

  // Avviso una tantum quando lo stato arriva e il server è spento (senza
  // sovrascrivere hint già mostrati da avvio/generazione).
  $effect(() => {
    if (server && !server.running && !hint) {
      hint = 'server 3D spento: premi "avvia server" qui sotto';
      error = true;
    }
  });

  const startServer = async () => {
    if (serverBusy || server?.running) return;
    serverBusy = true;
    error = false;
    hint = "avvio del server 3D… (preload del modello in background)";
    try {
      store.trellis = await start3D();
      hint = store.trellis.ready
        ? "server 3D pronto"
        : "server 3D avviato: il modello si sta caricando (prima volta ~30-60s)";
    } catch (e) {
      hint =
        "avvio del server 3D fallito: " + (e instanceof Error ? e.message : e);
      error = true;
    } finally {
      serverBusy = false;
    }
  };

  const stopServer = async () => {
    if (serverBusy || !server?.running) return;
    serverBusy = true;
    error = false;
    hint = "fermo del server 3D…";
    try {
      store.trellis = await stop3D();
      hint = "server 3D fermato";
    } catch (e) {
      hint =
        "fermo del server 3D fallito: " + (e instanceof Error ? e.message : e);
      error = true;
    } finally {
      serverBusy = false;
    }
  };
  onMount(() => {
    return () => {
      if (viewer) viewer.dispose();
    };
  });

  const loadFile = async (f: File) => {
    try {
      img = await Images.readImageAsDataURL(f);
      result = null;
      error = false;
      hint = "immagine caricata — pronta per la generazione 3D";
    } catch (e) {
      hint = e instanceof Error ? e.message : "lettura dell'immagine fallita";
      error = true;
    }
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!img || busy) return;
    busy = true;
    error = false;
    viewerErr = "";
    hint = "in generazione… (~1-2 min per l'asset)";
    try {
      const r = await generate3D({
        image: img,
        pipeline_type: pipelineType,
        seed,
      });
      result = r;
      hint = `fatto: ${r.vertices.toLocaleString("it-IT")} vertici · ${r.faces.toLocaleString("it-IT")} facce in ${r.time_s}s`;
      // il viewer è un extra: se fallisce, NON blocca il risultato.
      // tick(): senza di questo il <canvas bind:this> non è ancora stato
      // montato quando parte il render (Svelte 5 aggiorna il DOM in un
      // microtask) → canvas è null e il viewer esce senza disegnare nulla.
      await tick();
      try {
        if (canvas && !viewer) viewer = await createViewer3D(canvas);
        await viewer?.showGlb(r.glb_base64);
      } catch (verr) {
        viewerErr = String(verr instanceof Error ? verr.message : verr);
      }
    } catch (err) {
      hint = String(err instanceof Error ? err.message : err);
      error = true;
    } finally {
      busy = false;
    }
  };

  // download robusto del GLB: prima la URL servita dal hub, fallback sul base64.
  const downloadGlb = async () => {
    if (!result) return;
    const name = `palamede-3d-${result.seed}.glb`;
    const b64 = result.glb_base64;
    await downloadUrl(result.url, name, () =>
      new Blob([dataUrlToBytes(b64)], { type: "model/gltf-binary" }),
    );
  };

  // download STL (solo geometria): niente base64 nel risultato, quindi se il
  // fetch fallisce non c'è fallback — si mostra un hint all'utente.
  const downloadStl = async () => {
    if (!result?.stl_url) return;
    try {
      await downloadUrl(result.stl_url, `palamede-3d-${result.seed}.stl`);
    } catch {
      hint = "download STL non riuscito: riprova o scarica il GLB";
      error = true;
    }
  };
</script>

<div class="gen-wrap">
  <Panel as="form" onsubmit={submit}>
    <Eyebrow>Sezione 3D · TRELLIS.2</Eyebrow>
    <h1 class="sec-title" style="margin-top: 4px">Da immagine a mesh</h1>

    <div class="server-row">
      <ChatState state={server?.ready ? 'on' : server?.running ? 'busy' : 'off'}>
        {server?.running
          ? server.ready
            ? "server 3D pronto"
            : server.loading
              ? "server 3D in caricamento…"
              : "server 3D attivo · modello da caricare"
          : "server 3D spento"}
      </ChatState>
      {#if server?.running}
        <Button
          variant="side"
          onclick={stopServer}
          disabled={serverBusy}
        >
          {serverBusy ? "…" : "ferma"}
        </Button>
      {:else}
        <Button
          onclick={startServer}
          disabled={serverBusy}
        >
          {serverBusy ? "avvio…" : "avvia server"}
        </Button>
      {/if}
    </div>

    {#if img}
      <div class="img2img-prep">
        <img src={img} alt="immagine di partenza" />
        <div class="img2img-meta">
          <Button
            variant="side"
            onclick={() => {
              img = null;
              result = null;
              hint = "";
              error = false;
            }}
          >
            rimuovi immagine
          </Button>
        </div>
      </div>
    {:else}
      <Dropzone onfile={loadFile}>
        <span>+ Trascina un'immagine qui<br />o clicca per sceglierne una</span>
      </Dropzone>
    {/if}

    <div class="field-row">
      <Field label="Qualità" for="pipeline">
        <select id="pipeline" bind:value={pipelineType}>
          <option value="512">512 · veloce (consigliato)</option>
          <option value="1024">1024 · più dettagliata</option>
        </select>
      </Field>
      <Field label="Seed" for="seed">
        <input id="seed" type="number" min={-1} step={1} bind:value={seed} />
      </Field>
    </div>

    <Button
      type="submit"
      disabled={busy || !img || !server?.running || server?.loading}
    >
      {busy ? "in generazione…" : "Genera 3D"}
    </Button>
    <Hintline err={error}>{hint}</Hintline>
  </Panel>

  <section class="hist" aria-label="Risultato 3D">
    <HistHead eyebrow="Risultato" title="Asset 3D">
      {#snippet actions()}
        {#if result}
          <div class="dl-row">
            <Button
              variant="side"
              onclick={downloadGlb}
              title="Scarica il GLB texturizzato"
            >
              ⤓ Scarica GLB
            </Button>
            <Button
              variant="side"
              onclick={downloadStl}
              title="Scarica l'STL (solo geometria)"
            >
              ⤓ Scarica STL
            </Button>
          </div>
        {/if}
      {/snippet}
    </HistHead>

    {#if result}
      <div class="viewer-wrap">
        {#if !viewerErr}
          <canvas
            bind:this={canvas}
            style="width:100%;height:420px;border-radius:10px;background:#14181f"
          ></canvas>
        {:else}
          <EmptyState>
            Anteprima 3D non disponibile.<br />
            <span class="viewer-why">{viewerErr}</span><br />
            Scarica comunque il GLB o l'STL: i file sono pronti.
          </EmptyState>
        {/if}
        <div
          class="meta"
          style="margin-top:12px;font-size:12.5px;color:var(--paper-dim);line-height:1.7"
        >
          <div>
            {result.vertices.toLocaleString("it-IT")} vertici · {result.faces.toLocaleString(
              "it-IT",
            )} facce
          </div>
          <div>
            {result.time_s} s · picco VRAM {result.vram_peak_gb} GB · seed {result.seed}
            · {result.pipeline_type}
          </div>
        </div>
      </div>
    {:else}
      <EmptyState>
        Nessun asset generato.<br />
        Carica un'immagine, premi "Genera 3D": TRELLIS.2 produce un mesh texturizzato
        (GLB) in ~1-2 min a 512².
      </EmptyState>
    {/if}
  </section>
</div>

<style>
  .server-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px 0;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .server-row :global(.chat-state) {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    letter-spacing: 0.02em;
  }
  .server-row :global(.chat-state .led) {
    width: 8px;
    height: 8px;
  }
  .server-row :global(.chat-state.busy) {
    color: var(--amber);
  }
  .server-row :global(.go),
  .server-row :global(.side-toggle) {
    margin: 0;
    padding: 5px 12px;
    font-size: 11px;
    width: auto;
  }
  .img2img-prep {
    margin-top: 14px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .dl-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .img2img-prep img {
    max-width: 140px;
    border-radius: 8px;
    border: 1px solid var(--paper-dim);
  }
  .img2img-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .viewer-wrap canvas {
    display: block;
  }
  .viewer-why {
    font-size: 11px;
    color: var(--paper-dim);
    word-break: break-all;
  }
</style>
