# Palamede - ricompila l'exe automaticamente a ogni modifica
# dei sorgenti. Un FileSystemWatcher per cartella sorgente, debounce di 2 s,
# poi scripts/build.ps1 (frontend + Tauri).
# Uso:  .\scripts\watch.ps1
#       .\scripts\watch.ps1 -SkipFrontend   (non ricompila la UI a ogni colpo)
param([switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ── sorgenti osservati (mai le cartelle di output: la build si auto-triggererebbe) ──
$script:watchDirs = @(
    (Join-Path $Root 'backends'),
    (Join-Path $Root 'hub'),
    (Join-Path $Root 'src-tauri\src'),
    (Join-Path $Root 'scripts'),
    (Join-Path $Root 'frontend\src'),
    (Join-Path $Root 'frontend\public')
)

# sottostringhe escluse (dipendenze / artefatti / alberi enormi)
$script:excludes = @(
    '\node_modules\', '\dist\', '\outputs\', '\.git\',
    '\reference\', '\models\', '\tools\', '\knowledge\',
    '__pycache__', '\bundle-stage\', '\.vite\', '\src-tauri\target\'
)

$script:lastEvent = [DateTime]::MinValue
$script:debounce  = [TimeSpan]::FromSeconds(2)
$script:buildBusy = $false

function Test-Excluded([string]$path) {
    foreach ($e in $script:excludes) {
        if ($path.IndexOf($e, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
}

function Invoke-Rebuild {
    $script:buildBusy = $true
    try {
        Write-Host ("[{0}] modifica rilevata: build…" -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Yellow
        if ($SkipFrontend) {
            & (Join-Path $Root 'scripts\build.ps1') -SkipFrontend
        } else {
            & (Join-Path $Root 'scripts\build.ps1')
        }
    } finally {
        $script:buildBusy = $false
    }
}

# l'action gira in una scope figlia: usa $script: per toccare lo stato condiviso
$action = {
    if (Test-Excluded($_.FullPath)) { return }
    $script:lastEvent = Get-Date
}

$watchers = @()
foreach ($d in $script:watchDirs) {
    if (-not (Test-Path $d)) { continue }
    $fsw = New-Object System.IO.FileSystemWatcher
    $fsw.Path = $d
    $fsw.IncludeSubdirectories = $true
    $fsw.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
    foreach ($ev in @('Created', 'Changed', 'Renamed', 'Deleted')) {
        $watchers += Register-ObjectEvent -InputObject $fsw -EventName $ev -Action $action
    }
    $fsw.EnableRaisingEvents = $true
}

# file di configurazione del frontend alla radice (vite, tsconfig, package.json,
# index.html): osservati non-ricorsivamente, così node_modules resta fuori
$fswRoot = Join-Path $Root 'frontend'
if (Test-Path $fswRoot) {
    $fsw = New-Object System.IO.FileSystemWatcher
    $fsw.Path = $fswRoot
    $fsw.IncludeSubdirectories = $false
    $fsw.Filter = '*.{ts,json,html}'
    $fsw.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
    foreach ($ev in @('Created', 'Changed', 'Renamed', 'Deleted')) {
        $watchers += Register-ObjectEvent -InputObject $fsw -EventName $ev -Action $action
    }
    $fsw.EnableRaisingEvents = $true
}

Write-Host 'watch attivo: osservo backends, hub, src-tauri/src, scripts, frontend/src, frontend/public' -ForegroundColor Cyan
Write-Host 'premi Ctrl+C per fermare.' -ForegroundColor DarkGray

try {
    while ($true) {
        Start-Sleep -Milliseconds 500
        if ($script:buildBusy) { continue }
        if ($script:lastEvent -eq [DateTime]::MinValue) { continue }
        if (([DateTime]::Now - $script:lastEvent) -ge $script:debounce) {
            $script:lastEvent = [DateTime]::MinValue
            Invoke-Rebuild
        }
    }
} finally {
    foreach ($w in $watchers) {
        Unregister-Event -SourceIdentifier $w.Name -ErrorAction SilentlyContinue
    }
}