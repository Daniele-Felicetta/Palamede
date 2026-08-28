# Crea palamede.bundle: archivio con il codice dell'officina (frontend dist,
# hub, backends, scripts) + llama.cpp (tools/llama-cpp). Il bundle viene
# incorporato in Palamede.exe e estratto al primo avvio: il progetto quindi
# "vive dentro l'eseguibile".
#
# Uso:  .\scripts\build-bundle.ps1            (build frontend + bundle)
#       .\scripts\build-bundle.ps1 -SkipFrontend   (solo bundle)
param([switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

if (-not $SkipFrontend) {
    Push-Location (Join-Path $Root 'frontend')
    Write-Host 'npm run build…' -ForegroundColor Cyan
    npm run build
    Pop-Location
}

$staging = Join-Path $Root 'outputs\bundle-stage'
$zip = Join-Path $Root 'palamede.bundle'

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

foreach ($d in @('frontend\dist', 'hub', 'backends', 'scripts')) {
    & robocopy (Join-Path $Root $d) (Join-Path $staging $d) /E /NJH /NJS /NP /NFL /NDL | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy fallito per $d" }
}

# llama.cpp: il backend chat va dentro l'eseguibile
$llama = Join-Path $Root 'tools\llama-cpp'
if (Test-Path $llama) {
    & robocopy $llama (Join-Path $staging 'tools\llama-cpp') /E /NJH /NJS /NP /NFL /NDL | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'robocopy fallito per tools/llama-cpp' }
} else {
    Write-Warning 'tools\llama-cpp mancante: esegui scripts/setup.ps1 (senza llama.cpp il bundle non e'' completo)'
}

if (Test-Path $zip) { Remove-Item $zip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $staging, $zip,
    [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $staging -Recurse -Force

Write-Host ("palamede.bundle: {0:N0} MB" -f ((Get-Item $zip).Length / 1MB))
Write-Host 'ricompila l''exe con scripts/build-launcher.ps1 per incorporarlo' -ForegroundColor Yellow