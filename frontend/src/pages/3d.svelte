<script lang="ts">
  import { onMount, tick } from "svelte";
  import * as THREE from "three";
  import {
    get3DStatus,
    generate3D,
    start3D,
    stop3D,
    type Generate3DResult,
    type TrellisStatus,
  } from "../api";
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
  let server = $state<TrellisStatus | null>(null);
  let serverBusy = $state(false);
  let result = $state<Generate3DResult | null>(null);
  let viewerErr = $state("");

  let canvas: HTMLCanvasElement | null = $state(null);
  let viewer: { dispose: () => void } | null = $state(null);

  // stato del server 3D (processo avviato/fermato dal hub tramite /api/3d)
  const refreshStatus = async () => {
    try {
      server = await get3DStatus();
      if (!server.running && !hint) {
        hint = 'server 3D spento: premi "avvia server" qui sotto';
        error = true;
      }
    } catch {
      server = null;
      if (!hint) {
        hint = "hub non raggiungibile: stato server 3D sconosciuto";
        error = true;
      }
    }
  };
  onMount(() => {
    refreshStatus();
    // poll leggero: aggiorna il banner quando il modello finisce di caricare
    const t = setInterval(refreshStatus, 5_000);
    return () => clearInterval(t);
  });

  const startServer = async () => {
    if (serverBusy || server?.running) return;
    serverBusy = true;
    error = false;
    hint = "avvio del server 3D… (preload del modello in background)";
    try {
      server = await start3D();
      hint = server.ready
        ? "server 3D pronto"
        : "server 3D avviato: il modello si sta caricando (prima volta ~30-60s)";
    } catch (e) {
      server = null;
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
      server = await stop3D();
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

  const loadFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      hint = "il file non è un'immagine";
      error = true;
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      img = r.result as string;
      result = null;
      error = false;
      hint = "immagine caricata — pronta per la generazione 3D";
    };
    r.onerror = () => {
      hint = "lettura dell'immagine fallita";
      error = true;
    };
    r.readAsDataURL(f);
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
      // montato quando parte renderViewer (Svelte 5 aggiorna il DOM in un
      // microtask) → canvas è null e il viewer esce senza disegnare nulla.
      await tick();
      try {
        await renderViewer(r);
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
    try {
      const blob = await fetch(result.url).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      });
      saveBlob(blob, `palamede-3d-${result.seed}.glb`);
    } catch {
      const b64 = result.glb_base64.split(",")[1] ?? result.glb_base64;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      saveBlob(
        new Blob([bytes], { type: "model/gltf-binary" }),
        `palamede-3d-${result.seed}.glb`,
      );
    }
  };
  const saveBlob = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  // download STL (solo geometria): niente base64 nel risultato, quindi se il
  // fetch fallisce non c'è fallback — si mostra un hint all'utente.
  const downloadStl = async () => {
    if (!result?.stl_url) return;
    try {
      const blob = await fetch(result.stl_url).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      });
      saveBlob(blob, `palamede-3d-${result.seed}.stl`);
    } catch {
      hint = "download STL non riuscito: riprova o scarica il GLB";
      error = true;
    }
  };

  // viewer three.js (dipendenza npm locale, niente CDN)
  const renderViewer = async (r: Generate3DResult) => {
    if (!canvas) return;
    // nuova generazione: smantella il viewer precedente prima di crearne uno
    // nuovo (stesso canvas → stesso contesto WebGL, niente renderer multipli).
    if (viewer) {
      viewer.dispose();
      viewer = null;
    }
    const [{ GLTFLoader }, { OrbitControls }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ]);

    // decodifica il base64 del GLB in un Blob URL
    const b64 = r.glb_base64.split(",")[1] ?? r.glb_base64;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181f);
    const camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100,
    );
    camera.position.set(2, 1.6, 2.6);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(3, 5, 4);
    scene.add(dir);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    scene.add(gltf.scene);

    // centra e scala il mesh per inquadrarlo
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    gltf.scene.position.sub(center);
    camera.position.set(size, size * 0.8, size * 1.2);
    camera.lookAt(0, 0, 0);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    let raf = requestAnimationFrame(animate);

    // cleanup al cambio risultato / smontaggio
    viewer = {
      dispose: () => {
        cancelAnimationFrame(raf);
        controls.dispose();
        renderer.dispose();
        URL.revokeObjectURL(url);
      },
    };
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
