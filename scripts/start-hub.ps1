# Avvia il hub Palamede (:4600): statici della UI + proxy + metriche.
# -Hidden: nessuna console visibile, log in outputs/hub.log
param([int]$Port = 4600, [switch]$Hidden)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$dist = Join-Path $Root 'frontend\dist\index.html'
if (-not (Test-Path $dist)) {
    throw "frontend non costruito: cd frontend; npm install; npm run build"
}

$env:PALAMEDE_PORT = "$Port"

# vedi start-backend.ps1: 'Continue' per non morire sugli stderr dei nativi
$ErrorActionPreference = 'Continue'

if ($Hidden) {
    $log = Join-Path $Root 'outputs\hub.log'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
    Write-Host "Palamede hub :$Port - log: $log"
    node (Join-Path $Root 'hub\server.mjs') *> $log
} else {
    Write-Host "Hub su http://127.0.0.1:$Port" -ForegroundColor Cyan
    node (Join-Path $Root 'hub\server.mjs')
}