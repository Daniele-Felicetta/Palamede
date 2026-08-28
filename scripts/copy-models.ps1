# Ricopia/ricrea i pesi del progetto in models/ (gitignored).
# - bonsai ternary gemlite  ← reference/bonsai/models (robocopy, senza .cache)
# - z-image Q4_K_M          ← reference/
# - Qwen3-4B TE + VAE       ← HuggingFace (non sono in reference)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$M = Join-Path $Root 'models'
New-Item -ItemType Directory -Force -Path $M | Out-Null

# 1) bonsai
$src = Join-Path $Root 'reference\bonsai\models\bonsai-image-4B-ternary-gemlite'
if (Test-Path $src) {
    Write-Host "robocopy bonsai-ternary → models\" -ForegroundColor Cyan
    robocopy $src (Join-Path $M 'bonsai-image-4B-ternary-gemlite') /E /XD .cache /NFL /NDL /NJH /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy fallito ($LASTEXITCODE)" }
} else { Write-Warning "manca $src — scaricalo con .\scripts\..\setup.ps1 di reference/bonsai" }

# 2) z-image DiT
$z = Join-Path $Root 'reference\z-image-turbo-Q4_K_M.gguf'
if ((Test-Path $z) -and -not (Test-Path (Join-Path $M 'z-image-turbo-Q4_K_M.gguf'))) {
    Write-Host "copia z-image-turbo-Q4_K_M.gguf" -ForegroundColor Cyan
    Copy-Item $z $M
}

# 3) text encoder Qwen3-4B (serve a Z-Image)
$te = Join-Path $M 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
if (-not (Test-Path $te)) {
    Write-Host "scarico Qwen3-4B TE (2.5 GB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $te `
      'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
}

# 4) VAE Z-Image (ufficiale Tongyi, publico)
$vae = Join-Path $M 'z-image-vae.safetensors'
if (-not (Test-Path $vae)) {
    Write-Host "scarico Z-Image VAE (160 MB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $vae `
      'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/resolve/main/vae/diffusion_pytorch_model.safetensors'
}

Write-Host "models/ pronto:" -ForegroundColor Green
Get-ChildItem $M -Recurse -File | Measure-Object Length -Sum |
    ForEach-Object { "  {0:N2} GB totali" -f ($_.Sum / 1GB) }