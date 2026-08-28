# Setup one-time: engine sd-cpp, dipendenze frontend, build UI.
# I pesi dei modelli stanno in models/ (riempiti da copy-models.ps1).
param(
    # release di stable-diffusion.cpp (binari Windows CUDA 12)
    [string]$SdTag = 'master-829-0a565f2'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ── 1. stable-diffusion.cpp (sd-server.exe) ───────────────────────────────
$zip  = Join-Path $Root 'tools\sd-cpp.zip'
$dst  = Join-Path $Root 'tools\sd-cpp'
$exe  = Join-Path $dst 'sd-server.exe'
if (-not (Test-Path $exe)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'tools') | Out-Null
    $url = "https://github.com/leejet/stable-diffusion.cpp/releases/download/$SdTag/sd-$SdTag-bin-win-cuda12-x64.zip"
    Write-Host "scarico sd-cpp: $url" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $zip $url
    Expand-Archive -Path $zip -DestinationPath $dst -Force
    Remove-Item $zip
}
Write-Host "sd-server: $(Test-Path $exe)"

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
Write-Host "  .\scripts\start-bonsai.ps1   (finestra 1)"
Write-Host "  .\scripts\start-zimage.ps1   (finestra 2)"
Write-Host "  .\scripts\start-hub.ps1      (finestra 3)  → http://127.0.0.1:4600"