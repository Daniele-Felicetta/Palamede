<#
.SYNOPSIS
    Installazione UNICA di Palamede: un solo comando che prepara tutto.

.DESCRIPTION
    Catena i passi di setup gia' presenti nel repo, in ordine e in modo
    idempotente (ogni passo salta cio' che e' gia' a posto):

      1. prerequisiti        node.exe + uv nel PATH
      2. backend bonsai      reference\bonsai\setup.ps1   (~15 GB, venv Py3.11)
      3. engine + frontend   scripts\setup.ps1            (sd-cpp, llama.cpp, build UI)
      4. modelli             scripts\install-models.ps1   (menu interattivo)
      5. venv TRELLIS 3D     scripts\setup-trellis.ps1    (~20 GB, opzionale)

    E' il cuore dell'installer: Palamede.exe lo esegue da solo al primo avvio
    quando manca qualcosa di indispensabile. Va anche lanciato a mano.

.PARAMETER Select
    Modelli da installare al passo 4: '' (menu interattivo, default),
    'consigliati', 'tutti', oppure numeri tipo '1,3,5'.

.PARAMETER SkipModels
    Salta il passo modelli.

.PARAMETER SkipTrellis
    Salta il venv TRELLIS (3D). Utile se non ti serve il 3D o se non hai
    MSVC/nvcc: risparmia ~20 GB.

.PARAMETER SkipBonsai
    Salta il venv bonsai (serve solo se lo hai gia' da un'altra parte).

.EXAMPLE
    .\scripts\install-all.ps1
.EXAMPLE
    .\scripts\install-all.ps1 -Select consigliati -SkipTrellis
#>
[CmdletBinding()]
param(
    [string]$Select = '',
    [switch]$SkipModels,
    [switch]$SkipTrellis,
    [switch]$SkipBonsai
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
$PsExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Step($n, $m) { Write-Host "`n[$n/5] $m" -ForegroundColor Magenta }
function Info($m)      { Write-Host "      $m" -ForegroundColor Cyan }
function Ok($m)        { Write-Host "      $m" -ForegroundColor Green }
function Warn($m)      { Write-Host "      $m" -ForegroundColor Yellow }

# Esegue uno script figlio isolato e fallisce l'installazione se esce male.
function Invoke-Script([string]$RelPath, [string[]]$ExtraArgs = @()) {
    $path = Join-Path $Root ($RelPath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path)) { throw "manca lo script: $path" }
    & $PsExe -NoProfile -ExecutionPolicy Bypass -File $path @ExtraArgs
    if ($LASTEXITCODE -ne 0) { throw "$RelPath e' uscito con codice $LASTEXITCODE" }
}

Write-Host '============================================================' -ForegroundColor White
Write-Host '  PALAMEDE - installazione' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White
Info ("root: " + $Root)

# ---------------------------------------------------------------- 1. prerequisiti
Step 1 'prerequisiti (node, uv)'
foreach ($cmd in @('node', 'uv')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw ("Manca '{0}' nel PATH. " -f $cmd) + `
              "Node.js >= 20: https://nodejs.org - uv: https://docs.astral.sh/uv/"
    }
    Info ("{0} : {1}" -f $cmd, (Get-Command $cmd).Source)
}

# ---------------------------------------------------------------- 2. venv bonsai
Step 2 'backend bonsai (venv Py3.11 + torch)'
$BonsaiPy = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
if ($SkipBonsai) {
    Warn 'saltato (-SkipBonsai)'
} elseif (Test-Path -LiteralPath $BonsaiPy) {
    Ok 'gia'' presente, salto'
} else {
    Invoke-Script 'reference/bonsai/setup.ps1'
    if (-not (Test-Path -LiteralPath $BonsaiPy)) {
        throw "reference\bonsai\setup.ps1 ha terminato ma $BonsaiPy non esiste"
    }
    Ok 'venv bonsai pronto'
}

# ---------------------------------------------------------------- 3. engine + UI
Step 3 'engine sd-cpp + llama.cpp + build della UI'
Invoke-Script 'scripts/setup.ps1'
foreach ($need in @('tools\sd-cpp\sd-server.exe', 'tools\llama-cpp\llama-server.exe', 'frontend\dist\index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $need))) { throw "setup.ps1 ha terminato ma manca $need" }
}
Ok 'engine e UI pronti'

# ---------------------------------------------------------------- 4. modelli
Step 4 'modelli in models/'
$ModelsDir = Join-Path $Root 'models'
$hasModels = (Test-Path -LiteralPath $ModelsDir) -and
             (@(Get-ChildItem -LiteralPath $ModelsDir -Directory -ErrorAction SilentlyContinue).Count -gt 0)
if ($SkipModels) {
    Warn 'saltato (-SkipModels)'
} elseif ($hasModels -and -not $Select) {
    Ok 'modelli gia'' presenti, salto (usa -Select consigliati|tutti|1,3,5 per reinstallare)'
} else {
    $margs = @()
    if ($Select) { $margs += @('-Select', $Select) }
    Invoke-Script 'scripts/install-models.ps1' $margs
}

# ---------------------------------------------------------------- 5. TRELLIS 3D
Step 5 'venv TRELLIS.2 per il 3D (~20 GB)'
if ($SkipTrellis) {
    Warn 'saltato (-SkipTrellis): la pagina /3D non sara'' disponibile'
} elseif (Test-Path -LiteralPath (Join-Path $Root 'reference\trellis-venv\Scripts\python.exe')) {
    Ok 'gia'' presente, salto'
} else {
    Invoke-Script 'scripts/setup-trellis.ps1'
}

# ---------------------------------------------------------------- esito
Write-Host "`n============================================================" -ForegroundColor White
Write-Host '  RIEPILOGO' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White
$checks = [ordered]@{
    'backend bonsai (Py3.11)'   = 'reference\bonsai\.venv\Scripts\python.exe'
    'sd-server (immagini)'      = 'tools\sd-cpp\sd-server.exe'
    'llama-server (chat)'       = 'tools\llama-cpp\llama-server.exe'
    'UI compilata'              = 'frontend\dist\index.html'
    'venv TRELLIS (3D)'         = 'reference\trellis-venv\Scripts\python.exe'
}
$failed = $false
foreach ($k in $checks.Keys) {
    $p = Join-Path $Root $checks[$k]
    if (Test-Path -LiteralPath $p) { Ok   ("{0,-26} pronto" -f $k) }
    else                           { Warn ("{0,-26} MANCA ({1})" -f $k, $checks[$k]); if ($k -ne 'venv TRELLIS (3D)') { $failed = $true } }
}
if ($failed) { throw "Installazione incompleta: mancano componenti obbligatori (vedi riepilogo)." }
Write-Host "`nInstallazione completa. Avvia con start.bat oppure Palamede.exe." -ForegroundColor Green
exit 0
