# Setup one-time: engine sd-cpp, llama.cpp (chat), dipendenze frontend, build UI.
# I pesi dei modelli stanno in models/ (riempiti da copy-models.ps1).
param(
    # release di stable-diffusion.cpp (binari Windows CUDA 12). Deve contenere
    # il supporto Qwen-Image 2.1 (PR #1994, commit 137f740, dal 2026-09-20).
    [string]$SdTag = 'master-896-e112ab5',
    # release di llama.cpp (binari Windows CUDA)
    [string]$LlamaTag = 'b11457',
    # versione CUDA dei binari: accoppiata al tag, non indipendente. b11457
    # pubblica cuda-12.4 e cuda-13.4 (non piu' la 13.3 delle build precedenti),
    # quindi il parametro serve a non hardcodare una versione che non esiste.
    [string]$LlamaCuda = '13.4',
    # solo CPU (niente CUDA): scarica le build CPU di sd-cpp e llama.cpp e
    # scrive il marcatore tools\.cpu (letto dall'hub: -ngl 0, niente flash-attn).
    [switch]$CpuOnly
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ── 1. stable-diffusion.cpp (sd-server.exe) ───────────────────────────────
# L'asset di release si chiama "sd-master-<sha>-...": il tag ha anche un
# contatore (master-<n>-<sha>), quindi per l'URL ricaviamo il solo sha.
# Uno stamp del tag installato fa scattare l'aggiornamento quando cambia.
$zip   = Join-Path $Root 'tools\sd-cpp.zip'
$dst   = Join-Path $Root 'tools\sd-cpp'
$exe   = Join-Path $dst 'sd-server.exe'
$stamp = Join-Path $dst '.sd-tag'
$flavor = if ($CpuOnly) { 'cpu' } else { 'cuda12' }
$want = "$SdTag|$flavor"
$current = if (Test-Path $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { '' }
if (-not (Test-Path $exe) -or $current -ne $want) {
    $sha = 'master-' + ($SdTag -replace '^.*-', '')
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'tools') | Out-Null
    $url = "https://github.com/leejet/stable-diffusion.cpp/releases/download/$SdTag/sd-$sha-bin-win-$flavor-x64.zip"
    Write-Host "scarico sd-cpp ($SdTag, $flavor): $url" -ForegroundColor Cyan
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    curl.exe -L --fail --retry 3 -o $zip $url
    if ($LASTEXITCODE -ne 0) { throw "download sd-cpp fallito" }
    Expand-Archive -Path $zip -DestinationPath $dst -Force
    Remove-Item $zip
    Set-Content -LiteralPath (Join-Path $dst '.sd-tag') -Value $want
}
Write-Host "sd-server: $(Test-Path $exe)"

# ── 1b. llama.cpp (llama-server.exe per la chat) ──────────────────────────
$lzip   = Join-Path $Root 'tools\llama-cpp\download\llama.zip'
$lzip2  = Join-Path $Root 'tools\llama-cpp\download\cudart.zip'
$ldst   = Join-Path $Root 'tools\llama-cpp'
$lexe   = Join-Path $ldst 'llama-server.exe'
$lstamp = Join-Path $ldst '.llama-tag'
# installazioni pre-stamp (solo esistenza exe): erano tutte CUDA.
$lcurrent = if (Test-Path $lstamp) { (Get-Content -LiteralPath $lstamp -Raw).Trim() } else { 'cuda-legacy' }
$lwant = if ($CpuOnly) { "$LlamaTag|cpu" } else { "$LlamaTag|cuda-$LlamaCuda" }
$llamaOk = (Test-Path $lexe) -and ($lcurrent -eq $lwant -or (-not $CpuOnly -and $lcurrent -eq 'cuda-legacy'))
if (-not $llamaOk) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ldst 'download') | Out-Null
    if ($CpuOnly) {
        $url = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/llama-$LlamaTag-bin-win-cpu-x64.zip"
        Write-Host "scarico llama.cpp (solo CPU): $url" -ForegroundColor Cyan
        curl.exe -L --fail --retry 3 -o $lzip $url
        if ($LASTEXITCODE -ne 0) { throw "download llama.cpp fallito" }
        Expand-Archive -Path $lzip -DestinationPath $ldst -Force
    } else {
        $url = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/llama-$LlamaTag-bin-win-cuda-$LlamaCuda-x64.zip"
        $url2 = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/cudart-llama-bin-win-cuda-$LlamaCuda-x64.zip"
        Write-Host "scarico llama.cpp (CUDA $LlamaCuda): $url" -ForegroundColor Cyan
        curl.exe -L --fail --retry 3 -o $lzip $url
        if ($LASTEXITCODE -ne 0) { throw "download llama.cpp fallito" }
        curl.exe -L --fail --retry 3 -o $lzip2 $url2
        if ($LASTEXITCODE -ne 0) { throw "download cudart llama.cpp fallito" }
        Expand-Archive -Path $lzip  -DestinationPath $ldst -Force
        Expand-Archive -Path $lzip2 -DestinationPath $ldst -Force
    }
    Remove-Item (Join-Path $ldst 'download') -Recurse -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $lstamp -Value $lwant
}
Write-Host "llama-server: $(Test-Path $lexe)"

# ── 2. frontend ───────────────────────────────────────────────────────────
Push-Location (Join-Path $Root 'frontend')
Write-Host "npm install." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install fallito (exit $LASTEXITCODE)" }
Write-Host "npm run build." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm run build fallito (exit $LASTEXITCODE)" }
Pop-Location

# ── 2b. marcatore modalita' di calcolo (letto dall'hub: chat/rerank) ──────
$cpuMarker = Join-Path $Root 'tools\.cpu'
if ($CpuOnly) {
    Set-Content -LiteralPath $cpuMarker -Value 'cpu'
    Write-Host 'modalita'' solo CPU attiva (tools\.cpu): chat/rerank con -ngl 0.' -ForegroundColor Yellow
} elseif (Test-Path -LiteralPath $cpuMarker) {
    Remove-Item -LiteralPath $cpuMarker -Force
}

# ── 3. richiamo venv images (runtime del modelserver) ─────────────────────
$py = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
if (Test-Path $py) {
    # il venv di reference potrebbe non avere backend_gpu (editable saltato):
    # lo installiamo noi, senza toccare altro (solo se serve la GPU).
    $ok = & $py -c "import backend_gpu" 2>$null
    if (($LASTEXITCODE -ne 0) -and (-not $CpuOnly)) {
        Write-Host "installo backend_gpu (editable) nel venv images…" -ForegroundColor Cyan
        Push-Location (Join-Path $Root 'reference\bonsai')
        uv pip install -e vendor\image-studio\backend_gpu --no-deps --python .venv\Scripts\python.exe
        Pop-Location
    }
} else {
    Write-Warning "venv images non trovato: Esegui .\setup.ps1 dentro reference\bonsai (una tantum, ~5 GB con CUDA)"
}

Write-Host "`nSetup completo. Avvio tipico:" -ForegroundColor Green
Write-Host "  .\scripts\start-backend.ps1  (modello server dinamico :8000, finestra 1)"
Write-Host "  .\scripts\start-hub.ps1      (hub web :4600, finestra 2)  → http://127.0.0.1:4600"
Write-Host "  (la chat si avvia dalla pagina /chat: llama-server + parametri)"