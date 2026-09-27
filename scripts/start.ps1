# Palamede - avvio con UN comando solo (finestre nascoste, log in outputs/).
# Controlla cosa è già attivo, avvia modello server e hub se mancano,
# apre il browser.  .\scripts\start.ps1  oppure  start.bat / Palamede.exe
param([switch]$NoBrowser, [switch]$Visible)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$py   = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
$dist = Join-Path $Root 'frontend\dist\index.html'
if (-not (Test-Path $py))   { throw "venv images manca: esegui .\reference\bonsai\setup.ps1 una volta" }
if (-not (Test-Path $dist)) { throw "frontend non costruito: esegui .\scripts\setup.ps1 una volta" }

function Test-Port([int]$p) {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
    catch { return $false }
}

# Identita' del servizio: porta aperta NON basta (potrebbe esserci un altro
# programma). Verifica il marker JSON dell'endpoint prima di fidarsi.
function Test-Service([int]$p, [string]$path, [string]$marker) {
    if (-not (Test-Port $p)) { return 'assente' }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p$path" -TimeoutSec 4 -UseBasicParsing
        if ($r.Content -match [regex]::Escape($marker)) { return 'nostro' }
    } catch { }
    return 'estraneo'
}

# finestre nascoste di default; -Visible per debug (console minimizzate)
$hiddenArgs = if ($Visible) { @() } else { @('-Hidden') }
$winStyle   = if ($Visible) { 'Minimized' } else { 'Hidden' }

# ── modello server (:8000) ──
switch (Test-Service 8000 '/models' 'zimage_process') {
    'nostro'   { Write-Host '  modello server già attivo (:8000)' -ForegroundColor DarkGray }
    'estraneo' { throw 'porta 8000 occupata da un ALTRO servizio (non Palamede): liberala e riprova' }
    default {
        Write-Host '  avvio modello server (:8000)...' -ForegroundColor Cyan
        Start-Process powershell -ArgumentList (
            @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\start-backend.ps1')) + $hiddenArgs
        ) -WindowStyle $winStyle | Out-Null
    }
}

# ── hub (:4600) ──
switch (Test-Service 4600 '/api/health' '"current"') {
    'nostro'   { Write-Host '  hub già attivo (:4600)' -ForegroundColor DarkGray }
    'estraneo' { throw 'porta 4600 occupata da un ALTRO servizio (non Palamede): liberala e riprova' }
    default {
        Write-Host '  avvio hub (:4600)...' -ForegroundColor Cyan
        Start-Process powershell -ArgumentList (
            @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\start-hub.ps1')) + $hiddenArgs
        ) -WindowStyle $winStyle | Out-Null
    }
}

# ── attesa readiness (con identita', non solo porta aperta) ──
$deadline = (Get-Date).AddSeconds(90)
$b = $h = $false
while ((Get-Date) -lt $deadline) {
    if (-not $b) { $b = (Test-Service 8000 '/models' 'zimage_process') -eq 'nostro' }
    if (-not $h) { $h = (Test-Service 4600 '/api/health' '"current"') -eq 'nostro' }
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