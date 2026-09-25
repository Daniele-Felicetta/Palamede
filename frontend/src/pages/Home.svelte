<script lang="ts">
  import { navigate } from '../router.svelte'
  import { SECTIONS } from '../data/sections'
  import { Card, Gauge, SectionHead, Stamp } from '../components/ui'
</script>

<section class="apps" aria-label="Applicazioni">
  <div class="grid-cards">
    {#each SECTIONS.filter((s) => s.path !== '/') as s (s.path)}
      <Card
        live={s.live}
        glyph={s.glyph}
        title={s.title}
        foot={s.foot}
        href={'#' + s.path}
        onclick={(e) => { e.preventDefault(); navigate(s.path) }}
      />
    {/each}
  </div>
</section>

<section class="app-detail" aria-label="Le applicazioni nel dettaglio">
  <SectionHead
    title="Le applicazioni, nel dettaglio"
    sub="Palamede raccoglie i generatori che giri in casa: un hub, una coda, una wiki per tipo di modello — come funziona, quanto pesa, quanto ci mette, quanto rende, con esempi prodotti dai modelli stessi."
  />
  <div class="app-list">
    {#each SECTIONS.filter((s) => s.path !== '/') as s (s.path)}
      <div class="app-item">
        <span class="glyph">{s.glyph}</span>
        <div class="app-body">
          <h3>
            {s.title}
            <Stamp ok={s.live}>{s.live ? 'attiva' : 'bozza'}</Stamp>
          </h3>
          <p>{s.text}</p>
          <a
            class="app-go"
            href="#{s.path}"
            onclick={(e) => { e.preventDefault(); navigate(s.path) }}
          >
            {s.live ? 'apri la sezione →' : 'vedi la wiki →'}
          </a>
        </div>
      </div>
    {/each}
  </div>
</section>

<section aria-label="Misure" class="bench">
  <SectionHead
    title="Misure sul banco"
    sub="Tempi reali presi su questa macchina, GPU dedicata, warm (cache JIT già scaldata). Il primo colpo a una nuova risoluzione paga qualche secondo in più."
  />
  <Gauge
    cells={[
      { num: '1.8', unit: 's', label: 'Bonsai · 512² · 4 step' },
      { num: '3.3', unit: 's', label: 'Z-Image · 512² · 8 step' },
      { num: '6.4', unit: 's', label: 'Bonsai · 1024² · 4 step' },
      { num: '17.8', unit: 's', label: 'Z-Image · 1024² · 8 step' },
      { num: '6–8.5', unit: 'GB', label: 'VRAM per modello' },
    ]}
  />
</section>

<section class="experimental" aria-label="Sperimentazioni">
  <SectionHead
    title="Sperimentazioni"
    sub="Il riepilogo delle prove in officina: quello che abbiamo tentato e accantonato, e quello che stiamo provando adesso. La cronologia completa con i motivi e i rischi sta nella pagina Extra."
  />

  <h3 class="exp-group">Provato e accantonato</h3>
  <div class="exp-list">
    <div class="exp-item">
      <span class="exp-state sospeso">sospeso</span>
      <div class="exp-body">
        <h4>Video — Wan 2.1, LTX 2.5, Animatediff</h4>
        <p>
          Tre strade per la generazione video (Wan 2.1 T2V 1.3B con encoder
          UMT5, pipeline LTX 2.5 con VAE e upscaler, Animatediff Lightning
          4-step): pesi in <code>models/_inutilizzati/</code>, mai collegati
          all'hub. Per Wan esiste un server standalone non cablato
          (<code>backends/wan_server.py</code>).
        </p>
      </div>
    </div>
    <div class="exp-item">
      <span class="exp-state sospeso">sospeso</span>
      <div class="exp-body">
        <h4>FLUX.2-klein 9B</h4>
        <p>
          Tentativo di portare la variante 9B oltre al 4B attivo: sd.cpp non
          legge la quantizzazione NVFP4 ModelOpt, quindi dequantizzata in BF16
          (<code>scripts/convert-nvfp4-bf16.py</code>) e provata anche in GGUF
          Q4_0 — accantonata in <code>models/_inutilizzati/klein-9b/</code>.
        </p>
      </div>
    </div>
    <div class="exp-item">
      <span class="exp-state sostituito">sostituito</span>
      <div class="exp-body">
        <h4>3D — ComfyUI e Hunyuan3D</h4>
        <p>
          Generatori di mesh via ComfyUI headless: superati da TRELLIS.2 di
          Microsoft, integrato a mano e operativo nella pagina 3D (mesh + PBR,
          export GLB/STL).
        </p>
      </div>
    </div>
    <div class="exp-item">
      <span class="exp-state sostituito">sostituito</span>
      <div class="exp-body">
        <h4>RAG — da keyword a vettoriale</h4>
        <p>
          La vecchia ricerca per keyword (pattern LLM Wiki) è stata superata dal
          RAG in stile NotebookLM: chunk + embedding locale
          (<code>embeddinggemma</code> su Ollama), retrieval ibrido e rerank
          MiniCPM, risposte con citazioni cliccabili.
        </p>
      </div>
    </div>
    <div class="exp-item">
      <span class="exp-state bozza">bozza</span>
      <div class="exp-body">
        <h4>MCP — server per gli agenti</h4>
        <p>
          Esporre l'officina come server MCP stdio (wrapper JSON-RPC su
          <code>/api/image</code>): scritta la wiki, mai il server
          (<code>mcp/server.mjs</code>).
        </p>
      </div>
    </div>
  </div>

  <h3 class="exp-group">In prova adesso</h3>
  <div class="exp-list">
    <div class="exp-item">
      <span class="exp-state prova">in corso</span>
      <div class="exp-body">
        <h4>Model-antivirus</h4>
        <p>
          Scanner d'integrità dei pesi
          (<code>experimental/model-antivirus/</code>): verifica rapida
          (esistenza, dimensione, formato) all'avvio, audit di affidabilità
          con l'LLM locale al download. Integrato nel launcher.
        </p>
      </div>
    </div>
  </div>
  <p class="exp-go">
    <a
      class="app-go"
      href="#/extra"
      onclick={(e) => { e.preventDefault(); navigate('/extra') }}
    >
      la cronologia completa nella pagina Extra →
    </a>
  </p>
</section>
