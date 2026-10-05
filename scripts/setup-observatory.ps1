# Palamede — Osservatorio neurale: verifica che sia tutto in ordine.
#
# Controlla i quattro presupposti senza avviare nulla di pesante:
#   1. il venv che gira l'osservatorio esiste e ha torch CUDA + transformers 5.x
#   2. transformers supporta l'architettura ibrida di LFM2.5 (layer_types)
#   3. il checkpoint e' in formato Hugging Face, non GGUF
#   4. la porta 8131 e' libera
#
# Il terzo punto e' quello che fa fallire in silenzio la maggior parte dei
# tentativi: un .gguf non e' addestrabile da PyTorch, e LM Studio non puo'
# scrivere i pesi via HTTP.
#
#   .\scripts\setup-observatory.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'reference\trellis-venv\Scripts\python.exe'
$cwd = Join-Path $root 'experimental\neural-observatory'
$checkpoint = Join-Path $root 'models\lfm\lfm2.5-230m'

$fail = 0
function Step($name, $ok, $detail) {
    $tag = if ($ok) { '  [ok]  ' } else { '  [KO]  ' }
    $color = if ($ok) { 'Green' } else { 'Red' }
    Write-Host "$tag$name" -ForegroundColor $color -NoNewline
    if ($detail) { Write-Host "  $detail" -ForegroundColor DarkGray } else { Write-Host '' }
    if (-not $ok) { $script:fail++ }
}

Write-Host ''
Write-Host 'osservatorio neurale — verifica dei prerequisiti' -ForegroundColor Cyan
Write-Host ''

Step 'venv' (Test-Path -LiteralPath $python) $python
if (Test-Path -LiteralPath $python) {
    $probe = & $python -c @"
import importlib, json
out = {}
for m in ('torch', 'transformers'):
    try:
        out[m] = getattr(importlib.import_module(m), '__version__', '?')
    except Exception:
        out[m] = None
try:
    import torch
    out['cuda'] = bool(torch.cuda.is_available())
    out['gpu'] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
except Exception:
    out['cuda'] = False
    out['gpu'] = None
try:
    from transformers import Lfm2Config
    cfg = Lfm2Config()
    out['layer_types'] = 'layer_types' in {f for f in cfg.to_dict()}
except Exception as e:
    out['layer_types'] = f'errore: {e}'
print(json.dumps(out))
"@ 2>&1
    $j = $null
    try { $j = $probe | Select-Object -Last 1 | ConvertFrom-Json } catch { }
    if ($j) {
        Step 'torch' ($j.torch -ne $null) $j.torch
        Step 'CUDA' ($j.cuda -eq $true) $j.gpu
        Step 'transformers' ($j.transformers -ne $null) $j.transformers
        Step 'LFM2.5 ibrido (layer_types)' ($j.layer_types -eq $true) $(if ($j.layer_types -eq $true) { 'short_conv + full_attention' } else { $j.layer_types })
    }
    else {
        Step 'lettura versioni' $false 'il probe non ha risposto'
    }
}

$hasCfg = Test-Path -LiteralPath (Join-Path $checkpoint 'config.json')
$hasW = Test-Path -LiteralPath (Join-Path $checkpoint 'model.safetensors')
Step 'checkpoint Hugging Face' ($hasCfg -and $hasW) "$checkpoint"

if ($hasCfg) {
    $cfg = Get-Content -LiteralPath (Join-Path $checkpoint 'config.json') -Raw | ConvertFrom-Json
    $lt = $cfg.layer_types
    $attn = @($lt | Where-Object { $_ -eq 'full_attention' }).Count
    $conv = @($lt | Where-Object { $_ -eq 'conv' }).Count
    Step 'architettura ibrida' ($attn -gt 0 -and $conv -gt 0) "$($lt.Count) layer: $attn attention + $conv short conv"
    Step 'hidden_size' ($cfg.hidden_size -eq $cfg.block_dim) "$($cfg.hidden_size)"
    Step 'intermediate_size' ($cfg.intermediate_size -eq $cfg.block_ff_dim) `
        "$($cfg.intermediate_size) (auto-adjust disattivato: $($cfg.block_auto_adjust_ff_dim -eq $false))"
    Step 'lm_head tied' ($cfg.tie_word_embeddings -eq $true) "$($cfg.tie_word_embeddings)"
}

$ggufInObs = Get-ChildItem -LiteralPath $checkpoint -Filter *.gguf -ErrorAction SilentlyContinue
Step 'nessun GGUF nel checkpoint' ($null -eq $ggufInObs) $(if ($ggufInObs) { "$($ggufInObs.Count) file .gguf: non sono addestrabili" } else { '' })

$portBusy = Test-NetConnection -ComputerName 127.0.0.1 -Port 8131 -InformationLevel Quiet -WarningAction SilentlyContinue
Step 'porta 8131 libera' (-not $portBusy) $(if ($portBusy) { ' occupata: il backend è già in esercizio' } else { '' })

Write-Host ''
if ($fail -eq 0) {
    Write-Host 'tutto in ordine. avvio: .\scripts\start-observatory.ps1 -Load' -ForegroundColor Green
}
else {
    Write-Host "$fail verifiche fallite." -ForegroundColor Red
    Write-Host 'vedi README.md in experimental/neural-observatory/ per cosa manca.'
}
Write-Host ''
exit $fail
