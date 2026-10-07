# Palamede — avvia SOLO il server di chat (llama-server), senza il resto.
#
# Diverso da start.ps1: qui non parte l'app Tauri, quindi il Job Object che
# uccide i figli quando Palamede esce non esiste e il server sopravvive alla
# chiusura dell'app. Serve per usare un modello locale da un client esterno
# (OpenCode, Claude Code, Codex, un editor) che parli il protocollo OpenAI.
#
# Il server ascolta su 127.0.0.1:8121. Punta lì il tuo client.
#
# Uso:
#   .\scripts\start-chat.ps1                      # Darwin con MTP, contesto 32k
#   .\scripts\start-chat.ps1 -Model ornith-35b -Context 32768
#   .\scripts\start-chat.ps1 -Context 131072 -Kv q8_0
#
# Ctrl+C o .\scripts\stop-all.ps1 per fermarlo.

param(
    # 'pocket-darwin-180b' (default) oppure un altro id del catalogo
    [string]$Model = 'pocket-darwin-180b',
    # contesto per slot. Darwin con MTP regge bene fino a ~262k, ma oltre il
    # prefill rallenta parecchio (misurato: 58s a 4k, 65s a 131k, 102s a 262k).
    [int]$Context = 32768,
    # KV cache: q8_0 di default. Non e' il collo di bottiglia (i pesi lo sono),
    # ma q8_0 tiene piu' contesto per gli stessi byte.
    [string]$Kv = 'q8_0',
    # spec-decode MTP: solo Darwin, e solo con cpuMoe -1 (l'head del draft deve
    # stare in VRAM: con -ngl 99 il modello la occupa tutta e il draft
    # attraversa il PCIe a ogni token -> -5% invece di +33%).
    [switch]$NoMtp,
    [int]$Port = 8121
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ── build di llama.cpp: stessa risoluzione dell'hub (hub/lib/root.mjs) ──────
# b11457+ richiesto per l'MTP; con b10648 il draft non carica.
$llamaDir = @(
    $env:PALAMEDE_LLAMA_DIR,
    (Join-Path $Root 'tools\llama-cpp-b11457'),
    (Join-Path $Root 'tools\llama-cpp')
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'llama-server.exe')) } | Select-Object -First 1
if (-not $llamaDir) { throw "manca llama-server.exe: esegui .\scripts\setup.ps1" }
$llama = Join-Path $llamaDir 'llama-server.exe'

# ── modello: dal catalogo (scripts/models.catalog.json) ────────────────────
$cat = Get-Content (Join-Path $Root 'scripts\models.catalog.json') -Raw | ConvertFrom-Json
$entry = $cat.groups.models | Where-Object { $_.id -eq $Model }
if (-not $entry) { throw "modello '$Model' non nel catalogo" }
$file = Join-Path $Root ($entry.files[0].dest -replace '/', '\')
if (-not (Test-Path $file)) {
    throw "manca il peso $($entry.files[0].dest). Scaricalo: .\scripts\install-models.ps1 -List"
}

$isMoe = $entry.role -match 'MoE' -or $entry.name -match 'MoE'
$isDarwin = $Model -eq 'pocket-darwin-180b'

# ── argomenti ─────────────────────────────────────────────────────────────
$args = @(
    '-m', $file,
    '--host', '127.0.0.1', '--port', "$Port",
    '-c', "$Context",
    '-ngl', '99',
    '--flash-attn', 'on',
    "--cache-type-k", $Kv, "--cache-type-v", $Kv,
    '--no-op-offload',       # pesi che arrivano dall'SSD: nasconde la latenza I/O
    '--reasoning', 'off'     # reasoning si riaccende dalla UI; qui default spento
)

# MTP: solo Darwin, e solo con tutti gli esperti su CPU (libera VRAM per l'head)
$mtpHead = Join-Path $Root 'models\Pocket-Darwin-180B\mtp-Qwen3.8-Flash-Next-Q4_K_M.gguf'
if ($isDarwin -and -not $NoMtp) {
    if (Test-Path $mtpHead) {
        $args += '--cpu-moe'
        $args += '--spec-type', 'draft-mtp', '-md', $mtpHead
        $args += '--spec-draft-n-max', '2', '-ngld', 'all'
        Write-Host "MTP attivo (head: $(Split-Path $mtpHead -Leaf))" -ForegroundColor Cyan
    } else {
        $args += '--cpu-moe'
        Write-Host "head MTP non trovato: parto senza spec-decode (20 t/s invece di 26)" -ForegroundColor Yellow
    }
} elseif ($isMoe) {
    $args += '--cpu-moe'
}

Write-Host "modello : $($entry.name)"
Write-Host "file    : $(Split-Path $file -Leaf)"
Write-Host "contesto: $Context   KV: $Kv   build: $(Split-Path $llamaDir -Leaf)"
Write-Host "in ascolto su http://127.0.0.1:$Port  (Ctrl+C per fermare)" -ForegroundColor Green
Write-Host ""

# CREATE_NEW_PROCESS_GROUP: il server non muore quando chiude il chiamante.
& $llama @args