# Palamede — Osservatorio neurale: avvio (porta 8131).
#
# Il backend e' un servizio Python separato, come TRELLIS e il backend dei
# modelli. Questo script lo avvia in primo pianoo con i log sul terminale;
# per l'uso da app c'e' l'avvio dall'hub (GET /api/observatory/start), che
# passa da qui le stesse dipendenze.
#
#   .\scripts\start-observatory.ps1
#   .\scripts\start-observatory.ps1 -Load      # avvia e carica il modello
#   .\scripts\start-observatory.ps1 -Port 8131

[CmdletBinding()]
param(
    [int]$Port = 8131,
    [switch]$Load
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'reference\trellis-venv\Scripts\python.exe'
$cwd = Join-Path $root 'experimental\neural-observatory'
$cfgPath = Join-Path $cwd 'configs\default.json'
$checkpoint = Join-Path $root 'models\lfm\lfm2.5-230m'

if (-not (Test-Path -LiteralPath $python)) {
    throw "venv mancante: $python`nL'osservatorio gira su reference/trellis-venv (torch CUDA + transformers 5.x)."
}

if (-not (Test-Path -LiteralPath (Join-Path $checkpoint 'config.json'))) {
    throw "checkpoint mancante: $checkpoint`nServe un checkpoint Hugging Face (config.json + model.safetensors), NON un GGUF: i pesi devono essere addestrabili da PyTorch."
}

# Il backend legge la porta dalla config; se lo script ne riceve un'altra,
# la scrive, cosi' hub e frontend puntano allo stesso posto.
if ($Port -ne 8131 -and (Test-Path -LiteralPath $cfgPath)) {
    $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
    $cfg.port = $Port
    $cfg | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $cfgPath -Encoding utf8
    Write-Host "porta aggiornata a $Port in configs\default.json"
}

Write-Host 'osservatorio neurale — LFM2.5 230M' -ForegroundColor Cyan
Write-Host "  python    $python"
Write-Host "  checkpoint $checkpoint"
Write-Host "  ascolto    http://127.0.0.1:$Port"
Write-Host '  eventi     GET /api/stream  (text/event-stream)'
Write-Host '  frontend   da Palamede: pagina Osservatorio'
Write-Host ''

$env:PYTHONIOENCODING = 'utf-8'
Push-Location $cwd
try {
    if ($Load) {
        # avvia in background, aspetta lo health, poi chiedi il caricamento
        $job = Start-Job -ScriptBlock {
            param($py, $wd, $env2)
            Set-Location $wd
            & $py -m backend.server
        } -ArgumentList $python, $cwd, $env:PYTHONIOENCODING

        $ok = $false
        for ($i = 0; $i -lt 90; $i++) {
            Start-Sleep -Milliseconds 500
            try {
                if (Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2) { $ok = $true; break }
            } catch { }
        }
        if (-not $ok) { throw "il backend non ha risposto entro 45 s" }

        Write-Host 'carico i pesi in GPU…' -ForegroundColor Yellow
        $r = Invoke-RestMethod "http://127.0.0.1:$Port/api/load" -Method Post -TimeoutSec 300
        Write-Host ("  {0:N0} parametri in {1} ms  ({2} tensori)" -f `
            $r.model.base_params, $r.model.load_ms, $r.model.tensors) -ForegroundColor Green
        Write-Host ("  warmup: prima generazione {0} ms invece di ~13600 ms" -f $r.model.warmup.generate_ms)
        Write-Host ''
        Write-Host 'pronto. lascia questo terminale aperto.' -ForegroundColor Green
        Receive-Job $job -Wait
    }
    else {
        & $python -m backend.server
    }
}
finally {
    Pop-Location
}
