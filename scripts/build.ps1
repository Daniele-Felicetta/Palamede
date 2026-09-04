# Palamede - build completa in UN comando: frontend + app Tauri (Palamede.exe).
# Uso:  .\scripts\build.ps1             (tutto, dalla UI all'exe)
#       .\scripts\build.ps1 -SkipFrontend   (solo rebuild dell'exe Tauri)
#
# Pipeline:
#   1. frontend: npm run build (frontend/dist)
#   2. Tauri:    cargo build --release (src-tauri/target/release/palamede.exe)
#   3. copia:    palamede.exe -> Palamede.exe alla radice
#
# Nota: Kaspersky e altri AV possono bloccare/eliminare gli .exe appena
# compilati da Rust. In tal caso aggiungi un'esclusione per la cartella
# src-tauri/target (e per la radice) e riprova.
param([switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

Write-Host '== build Palamede (Tauri) ==' -ForegroundColor Cyan

if (-not $SkipFrontend) {
    Write-Host '- frontend (Vite + React)' -ForegroundColor Yellow
    Push-Location (Join-Path $Root 'frontend')
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm build fallito ($LASTEXITCODE)" }
    }
    finally {
        Pop-Location
    }
}

Write-Host '- app Tauri (cargo build --release)' -ForegroundColor Yellow
Push-Location (Join-Path $Root 'src-tauri')
try {
    # cargo scrive il progresso su stderr: con ErrorActionPreference='Stop'
    # ogni riga diverrebbe un NativeCommandError. Qui serve 'Continue'.
    $ErrorActionPreference = 'Continue'
    cargo build --release 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "cargo build fallito ($LASTEXITCODE)" }
    $ErrorActionPreference = 'Stop'
}
finally {
    Pop-Location
}

$srcExe = Join-Path $Root 'src-tauri\target\release\palamede.exe'
$dstExe = Join-Path $Root 'Palamede.exe'
if (-not (Test-Path $srcExe)) { throw "exe non trovato: $srcExe" }

# se Palamede.exe e' in esecuzione, chiudi prima di sovrascrivere
$running = Get-Process -Name 'Palamede' -ErrorAction SilentlyContinue
if ($running) {
    Stop-Process -Name 'Palamede' -Force
    Start-Sleep 1
}
Copy-Item $srcExe $dstExe -Force

$mbExe = [math]::Round((Get-Item $dstExe).Length / 1MB, 1)
$mbSrc = [math]::Round((Get-Item $srcExe).Length / 1MB, 1)
Write-Host "Palamede.exe aggiornato: $mbExe MB (da $mbSrc MB)"
Write-Host '== build completata ==' -ForegroundColor Green