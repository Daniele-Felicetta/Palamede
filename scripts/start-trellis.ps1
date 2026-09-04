# Avvia il server 3D TRELLIS.2 (:8124) nel venv SEPARATO (reference/trellis-venv).
# -Hidden: nessuna console visibile, log in outputs/trellis.log.
# POST /generate {image(dataUrl), pipeline_type, seed, num_samples} → GLB texturizzato.
param([int]$Port = 8124, [switch]$Hidden)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$py = Join-Path $Root 'reference\trellis-venv\Scripts\python.exe'

if (-not (Test-Path $py)) {
    throw ("manca il venv TRELLIS in " + $py + " (vedi SPEC.md - il venv usa Python 3.13 + torch cu130, config testata).")
}

$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8       = '1'
$env:ATTN_BACKEND     = 'sdpa'

$uvicornArgs = @('-m', 'uvicorn', 'backends.trellis_server:app', '--port', "$Port")

if ($Hidden) {
    $log = Join-Path $Root 'outputs\trellis.log'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
    Write-Host "Palamede TRELLIS.2 3D server :$Port - log: $log"
    Push-Location $Root
    & $py @uvicornArgs *> $log
    Pop-Location
} else {
    Write-Host 'Palamede TRELLIS.2 3D server (image-to-3D, venv separato)' -ForegroundColor Cyan
    Push-Location $Root
    & $py @uvicornArgs
    Pop-Location
}