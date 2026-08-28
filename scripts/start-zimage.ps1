# Avvia Z-Image Turbo tramite sd-server (stable-diffusion.cpp, :8123).
# Richiede: tools/sd-cpp (scripts/setup.ps1) e i tre pesi in models/.
param([int]$Port = 8123)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$exe  = Join-Path $Root 'tools\sd-cpp\sd-server.exe'
$dit  = Join-Path $Root 'models\z-image-turbo-Q4_K_M.gguf'
$vae  = Join-Path $Root 'models\z-image-vae.safetensors'
$te   = Join-Path $Root 'models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf'

foreach ($p in @($exe, $dit, $vae, $te)) {
    if (-not (Test-Path $p)) { throw "manca: $p (vedi scripts/setup.ps1 e scripts/copy-models.ps1)" }
}

Write-Host "Z-Image (sd-server) su :$Port" -ForegroundColor Cyan
& $exe `
    --diffusion-model $dit `
    --vae $vae `
    --llm $te `
    --diffusion-fa `
    --listen-port $Port