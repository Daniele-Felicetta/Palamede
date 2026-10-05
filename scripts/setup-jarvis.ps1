#Requires -Version 5.1
# Setup Jarvis F0 (solo verifiche locali, nessun download):
# controlla pesi in models/Jarvis + llama-server + venv Python per STT/TTS.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$need = @(
  'models\Jarvis\gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  'models\Jarvis\Parakeet\parakeet-tdt-0.6b-v3.q8_0.gguf',
  'models\Jarvis\t3_mtl23ls_v3.safetensors',
  'models\Jarvis\s3gen_v3.safetensors',
  'models\Jarvis\ve.safetensors',
  'models\Jarvis\kokoro\kokoro-v1_0.pth',
  'tools\llama-cpp\llama-server.exe'
)
$missing = @()
foreach ($p in $need) {
  if (Test-Path -LiteralPath (Join-Path $Root $p)) { Write-Host "OK  $p" }
  else { Write-Host "MANCA  $p"; $missing += $p }
}
if ($missing.Count -gt 0) { throw "Pesi mancanti: $($missing -join ', ')" }

Write-Host '--- supervisor status ---'
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) { & python 'jarvis-livekit\supervisor.py' status } else { Write-Warning 'python non trovato: salta check supervisor' }
Write-Host '--- agent tools ---'
if ($py) { & python 'jarvis-livekit\agent.py' tools } else { Write-Warning 'python non trovato: salta check agent' }
Write-Host 'Jarvis F0 pronto: apri /jarvis dopo start.ps1'
