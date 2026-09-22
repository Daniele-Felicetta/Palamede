# Setup one-time: engine sd-cpp, llama.cpp (chat), dipendenze frontend, build UI.
# I pesi dei modelli stanno in models/ (riempiti da copy-models.ps1).
param(
    # release di stable-diffusion.cpp (binari Windows CUDA 12). Deve contenere
    # il supporto Qwen-Image 2.1 (PR #1994, commit 137f740, dal 2026-09-20).
    [string]$SdTag = 'master-896-e112ab5',
    # release di llama.cpp (binari Windows CUDA)
    [string]$LlamaTag = 'b10679'
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
$current = if (Test-Path $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { '' }
if (-not (Test-Path $exe) -or $current -ne $SdTag) {
    $sha = 'master-' + ($SdTag -replace '^.*-', '')
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'tools') | Out-Null
    $url = "https://github.com/leejet/stable-diffusion.cpp/releases/download/$SdTag/sd-$sha-bin-win-cuda12-x64.zip"
    Write-Host "scarico sd-cpp ($SdTag): $url" -ForegroundColor Cyan
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    curl.exe -L --fail --retry 3 -o $zip $url
    if ($LASTEXITCODE -ne 0) { throw "download sd-cpp fallito" }
    Expand-Archive -Path $zip -DestinationPath $dst -Force
    Remove-Item $zip
    Set-Content -LiteralPath (Join-Path $dst '.sd-tag') -Value $SdTag
}
Write-Host "sd-server: $(Test-Path $exe)"

# ── 1b. llama.cpp (llama-server.exe per la chat) ──────────────────────────
$lzip   = Join-Path $Root 'tools\llama-cpp\download\llama.zip'
$lzip2  = Join-Path $Root 'tools\llama-cpp\download\cudart.zip'
$ldst   = Join-Path $Root 'tools\llama-cpp'
$lexe   = Join-Path $ldst 'llama-server.exe'
if (-not (Test-Path $lexe)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ldst 'download') | Out-Null
    $url = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/llama-$LlamaTag-bin-win-cuda-13.3-x64.zip"
    $url2 = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/cudart-llama-bin-win-cuda-13.3-x64.zip"
    Write-Host "scarico llama.cpp (CUDA 13.3): $url" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $lzip $url
    curl.exe -L --fail --retry 3 -o $lzip2 $url2
    Expand-Archive -Path $lzip  -DestinationPath $ldst -Force
    Expand-Archive -Path $lzip2 -DestinationPath $ldst -Force
    Remove-Item (Join-Path $ldst 'download') -Recurse -Force
}
Write-Host "llama-server: $(Test-Path $lexe)"

# ── 2. frontend ───────────────────────────────────────────────────────────
Push-Location (Join-Path $Root 'frontend')
Write-Host "npm install…" -ForegroundColor Cyan
npm install --no-audit --no-fund
Write-Host "npm run build…" -ForegroundColor Cyan
npm run build
Pop-Location

# ── 3. richiamo backend bonsai (venv in reference) ───────────────────────
$py = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
if (Test-Path $py) {
    # il venv di reference potrebbe non avere backend_gpu (editable saltato):
    # lo installiamo noi, senza toccare altro.
    $ok = & $py -c "import backend_gpu" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "installo backend_gpu (editable) nel venv di reference…" -ForegroundColor Cyan
        Push-Location (Join-Path $Root 'reference\bonsai')
        uv pip install -e vendor\image-studio\backend_gpu --no-deps --python .venv\Scripts\python.exe
        Pop-Location
    }
} else {
    Write-Warning "reference\bonsai\.venv non trovato: Esegui .\setup.ps1 dentro reference\bonsai (una tantum, richiede ~15 GB)"
}

Write-Host "`nSetup completo. Avvio tipico:" -ForegroundColor Green
Write-Host "  .\scripts\start-backend.ps1  (modello server dinamico :8000, finestra 1)"
Write-Host "  .\scripts\start-hub.ps1      (hub web :4600, finestra 2)  → http://127.0.0.1:4600"
Write-Host "  (la chat si avvia dalla pagina /chat: llama-server + parametri)"