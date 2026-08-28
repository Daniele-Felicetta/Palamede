# Avvia il backend Bonsai (FastAPI :8000) usando il wrapper con fix loader.
# Richiede: reference/bonsai con venv già installato (setup.ps1 del repo
# sorgente) e models/bonsai-image-4B-ternary-gemlite presente.
param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$repo  = Join-Path $Root 'reference\bonsai'
$py    = Join-Path $repo  '.venv\Scripts\python.exe'
$model = Join-Path $Root  'models\bonsai-image-4B-ternary-gemlite'

foreach ($p in @($py, $model)) {
    if (-not (Test-Path $p)) { throw "manca: $p" }
}

$env:MFLUX_STUDIO_GPU_DEFAULT_BACKEND      = 'bonsai-ternary-gemlite'
$env:MFLUX_STUDIO_GPU_TEXT_ENCODER_PATH    = Join-Path $model 'text_encoder-hqq-4bit'
$env:MFLUX_STUDIO_GPU_VAE_PATH             = Join-Path $model 'vae'
$env:MFLUX_STUDIO_GPU_TOKENIZER_PATH       = Join-Path $model 'text_encoder-hqq-4bit\tokenizer'
$env:MFLUX_STUDIO_GPU_TERNARY_TRANSFORMER_PATH = Join-Path $model 'transformer-gemlite-int2'
$env:MFLUX_STUDIO_GPU_BINARY_TRANSFORMER_PATH  = Join-Path $model 'transformer-gemlite-int2'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8       = '1'

Write-Host "Bonsai su :$Port (warmup al primo uso di ogni risoluzione)" -ForegroundColor Cyan
Push-Location $Root
& $py -m uvicorn backends.bonsai_backend:app --port $Port
Pop-Location