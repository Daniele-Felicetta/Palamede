# Ricopia/ricrea i pesi del progetto in models/ (gitignored).
# - bonsai ternary gemlite  ← reference/bonsai/models (robocopy, senza .cache)
# - z-image Q4_K_M          ← reference/
# - Qwen3-4B TE + VAE       ← HuggingFace (non sono in reference)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$M = Join-Path $Root 'models'
$Py = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
$Audit = Join-Path $Root 'experimental\model-antivirus\audit-model.py'
New-Item -ItemType Directory -Force -Path $M | Out-Null

function Invoke-AuditModel($file, $url) {
    # audit di affidabilità (giudice LLM locale se attivo; all'avvio non serve)
    if ((Test-Path $Py) -and (Test-Path $Audit)) {
        & $Py $Audit $file -Source $url --json
        if ($LASTEXITCODE -eq 2) { Remove-Item $file -Force; throw "AUDIT FALLITO: modello respinto ($url)" }
        if ($LASTEXITCODE -eq 3) { Write-Warning "audit: giudice LLM non disponibile, file tenuto (verifiche deterministiche ok)" }
    }
}

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
    Invoke-AuditModel $te 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
}

# 4) VAE Z-Image (ufficiale Tongyi, publico)
$vae = Join-Path $M 'z-image-vae.safetensors'
if (-not (Test-Path $vae)) {
    Write-Host "scarico Z-Image VAE (160 MB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $vae `
      'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/resolve/main/vae/diffusion_pytorch_model.safetensors'
    Invoke-AuditModel $vae 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/resolve/main/vae/diffusion_pytorch_model.safetensors'
}

# 5) VAE FLUX.2 (serve al modello klein (FLUX.2 4B); pubblico Apache-2.0)
$fv = Join-Path $M 'flux2-vae.safetensors'
if (-not (Test-Path $fv)) {
    Write-Host "scarico VAE FLUX.2 (0.32 GB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $fv `
      'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors'
    Invoke-AuditModel $fv 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors'
}

# 6) Qwen-Image 2.1 (sd-server): DiT GGUF + VAE + text encoder Qwen3-VL-8B.
#    Nota: servono 3 pezzi (il DiT è solo il denoiser); VAE e text encoder
#    NON sono intercambiabili con quelli di Qwen-Image 1 / Wan 2.2.
$qdir = Join-Path $M 'qwen-image'
$qdit = Join-Path $qdir 'qwen-image-2.1-Q4_K_M.gguf'
$qvae = Join-Path $qdir 'qwen_image_2.1_vae_bf16.safetensors'
$qte  = Join-Path $qdir 'Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf'
New-Item -ItemType Directory -Force -Path $qdir | Out-Null
if (-not (Test-Path $qdit)) {
    Write-Host "scarico Qwen-Image 2.1 DiT Q4_K_M (4.2 GB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $qdit `
      'https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF/resolve/main/qwen-image-2.1-Q4_K_M.gguf'
    Invoke-AuditModel $qdit 'https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF/resolve/main/qwen-image-2.1-Q4_K_M.gguf'
}
if (-not (Test-Path $qvae)) {
    Write-Host "scarico Qwen-Image 2.1 VAE (~0.68 GB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $qvae `
      'https://huggingface.co/unsloth/Qwen-Image-2.1-FP8/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors'
    Invoke-AuditModel $qvae 'https://huggingface.co/unsloth/Qwen-Image-2.1-FP8/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors'
}
if (-not (Test-Path $qte)) {
    Write-Host "scarico Qwen3-VL-8B text encoder (~5.1 GB)…" -ForegroundColor Cyan
    curl.exe -L --fail --retry 3 -o $qte `
      'https://huggingface.co/unsloth/Qwen3-VL-8B-Instruct-GGUF/resolve/main/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf'
    Invoke-AuditModel $qte 'https://huggingface.co/unsloth/Qwen3-VL-8B-Instruct-GGUF/resolve/main/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf'
}

Write-Host "models/ pronto:" -ForegroundColor Green
Get-ChildItem $M -Recurse -File | Measure-Object Length -Sum |
    ForEach-Object { "  {0:N2} GB totali" -f ($_.Sum / 1GB) }