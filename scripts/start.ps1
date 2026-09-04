# Palamede - avvio con UN comando solo (finestre nascoste, log in outputs/).
# Controlla cosa è già attivo, avvia modello server e hub se mancano,
# apre il browser.  .\scripts\start.ps1  oppure  start.bat / Palamede.exe
param([switch]$NoBrowser, [switch]$Visible)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$py   = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
$dist = Join-Path $Root 'frontend\dist\index.html'
if (-not (Test-Path $py))   { throw "venv bonsai manca: esegui .\reference\bonsai\setup.ps1 una volta" }
if (-not (Test-Path $dist)) { throw "frontend non costruito: esegui .\scripts\setup.ps1 una volta" }

function Test-Port([int]$p) {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
    catch { return $false }
}

# finestre nascoste di default; -Visible per debug (console minimizzate)
$hiddenArgs = if ($Visible) { @() } else { @('-Hidden') }
$winStyle   = if ($Visible) { 'Minimized' } else { 'Hidden' }

# ── modello server (:8000) ──
if (Test-Port 8000) {
    Write-Host '  modello server già attivo (:8000)' -ForegroundColor DarkGray
} else {
    Write-Host '  avvio modello server (:8000)...' -ForegroundColor Cyan
    Start-Process powershell -ArgumentList (
        @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\start-backend.ps1')) + $hiddenArgs
    ) -WindowStyle $winStyle | Out-Null
}

# ── hub (:4600) ──
if (Test-Port 4600) {
    Write-Host '  hub già attivo (:4600)' -ForegroundColor DarkGray
} else {
    Write-Host '  avvio hub (:4600)...' -ForegroundColor Cyan
    Start-Process powershell -ArgumentList (
        @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\start-hub.ps1')) + $hiddenArgs
    ) -WindowStyle $winStyle | Out-Null
}

# ── attesa readiness ──
$deadline = (Get-Date).AddSeconds(90)
$b = $h = $false
while ((Get-Date) -lt $deadline) {
    if (-not $b) { $b = Test-Port 8000 }
    if (-not $h) { $h = Test-Port 4600 }
    if ($b -and $h) { break }
    Start-Sleep -Milliseconds 800
}

Write-Host ''
if ($b -and $h) {
    Write-Host '  Palamede pronto  ->  http://127.0.0.1:4600' -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4600' }
    Write-Host ''
    Write-Host '  log: outputs\backend.log e outputs\hub.log' -ForegroundColor DarkGray
    Write-Host '  ferma tutto: .\scripts\stop-all.ps1' -ForegroundColor DarkGray
} else {
    Write-Warning "  non pronto (backend=$b hub=$h) - guarda i log in outputs/"
    exit 1
}