# Avvia l'UNICO modello server dinamico (:8000).
# -Hidden: nessuna console visibile, log in outputs/backend.log
# Carica Bonsai (gemlite in-process) o Z-Image (spawna sd-server come
# subprocess) alla selezione: POST /select {model}. Un modello alla volta.
param([int]$Port = 8000, [switch]$Hidden)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$py    = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
$model = Join-Path $Root 'models\bonsai-image-4B-ternary-gemlite'
$zexe  = Join-Path $Root 'tools\sd-cpp\sd-server.exe'

foreach ($p in @($py, $model, $zexe)) {
    if (-not (Test-Path $p)) { throw "manca: $p (vedi scripts/setup.ps1 e scripts/copy-models.ps1)" }
}

$env:MFLUX_STUDIO_GPU_DEFAULT_BACKEND      = 'bonsai-ternary-gemlite'
$env:MFLUX_STUDIO_GPU_TEXT_ENCODER_PATH    = Join-Path $model 'text_encoder-hqq-4bit'
$env:MFLUX_STUDIO_GPU_VAE_PATH             = Join-Path $model 'vae'
$env:MFLUX_STUDIO_GPU_TOKENIZER_PATH       = Join-Path $model 'text_encoder-hqq-4bit\tokenizer'
$env:MFLUX_STUDIO_GPU_TERNARY_TRANSFORMER_PATH = Join-Path $model 'transformer-gemlite-int2'
$env:MFLUX_STUDIO_GPU_BINARY_TRANSFORMER_PATH  = Join-Path $model 'transformer-gemlite-int2'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8       = '1'

$uvicornArgs = @('-m', 'uvicorn', 'backends.modelserver:app', '--port', "$Port")

# I processi nativi (python/uvicorn) scrivono warning su stderr: con
# $ErrorActionPreference='Stop' un semplice warning diverrebbe un
# NativeCommandError e ucciderebbe lo script. Qui deve essere 'Continue'.
$ErrorActionPreference = 'Continue'

if ($Hidden) {
    $log = Join-Path $Root 'outputs\backend.log'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
    Write-Host "Palamede modello server :$Port - log: $log"
    Push-Location $Root
    & $py @uvicornArgs *> $log
    Pop-Location
} else {
    Write-Host 'Palamede modello server (caricamento dinamico: bonsai / zimage)' -ForegroundColor Cyan
    Push-Location $Root
    & $py @uvicornArgs
    Pop-Location
}