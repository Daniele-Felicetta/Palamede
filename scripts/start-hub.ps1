# Avvia il hub Palamede (:4600): statici della UI + proxy + coda mutex GPU.
param([int]$Port = 4600)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$dist = Join-Path $Root 'frontend\dist\index.html'
if (-not (Test-Path $dist)) {
    throw "frontend non costruito: cd frontend; npm install; npm run build"
}

$env:PALAMEDE_PORT = "$Port"
Write-Host "Hub su http://127.0.0.1:$Port" -ForegroundColor Cyan
node (Join-Path $Root 'hub\server.mjs')