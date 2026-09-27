<#
.SYNOPSIS
    Installazione UNICA di Palamede: un solo comando che prepara tutto.

.DESCRIPTION
    Catena i passi di setup gia' presenti nel repo, in ordine e in modo
    idempotente (ogni passo salta cio' che e' gia' a posto):

      1. prerequisiti        node.exe + uv nel PATH
      2. venv images         reference\bonsai\setup.ps1   (~5 GB: Py3.11 + torch CUDA)
      3. engine + frontend   scripts\setup.ps1            (sd-cpp, llama.cpp, build UI)
      4. modelli             scripts\install-models.ps1   (menu interattivo)
      5. venv TRELLIS 3D     scripts\setup-trellis.ps1    (~25 GB totali, solo pagina /3D)

    E' il cuore dell'installer: Palamede.exe lo esegue da solo al primo avvio
    quando manca qualcosa di indispensabile. Va anche lanciato a mano.

.PARAMETER Select
    Modelli da installare al passo 4: '' (menu interattivo, default),
    'consigliati', 'tutti', oppure numeri tipo '1,3,5'.

.PARAMETER Steps
    Esegue solo questi passi (nomi: Prereqs, Images, Engine, Models, Trellis).
    'Bonsai' e' accettato come alias di Images (compatibilita').
    Es.: -Steps Images,Engine . Di default li esegue tutti (meno gli -Skip*).

.PARAMETER CpuOnly
    Modalita' solo CPU (niente CUDA): engine in build CPU, venv images senza
    stack GPU (torch/triton/gemlite saltati), TRELLIS escluso (richiede CUDA),
    chat e rerank con -ngl 0. Il modello bonsai non sara' selezionabile
    (richiede CUDA); zimage/klein/qwenimage funzionano su CPU (lenti).

.PARAMETER SkipModels
    Salta il passo modelli.

.PARAMETER SkipEngine
    Salta engine sd-cpp + llama.cpp + build UI.

.PARAMETER SkipTrellis
    Salta il venv TRELLIS (3D). Utile se non ti serve il 3D o se non hai
    MSVC/nvcc: risparmia ~25 GB.

.PARAMETER SkipBonsai
    Salta venv images (solo se usi un backend esterno).

.PARAMETER ListSteps
    Elenca i passi disponibili ed esce.

.PARAMETER NoClone
    Non clonare reference\bonsai da GitHub quando manca: fallisce con
    istruzioni manuali invece di clonare in automatico.

.PARAMETER BonsaiRepo
    URL del repo Bonsai da clonare in reference\bonsai quando manca.

.EXAMPLE
    .\scripts\install-all.ps1
.EXAMPLE
    .\scripts\install-all.ps1 -Select consigliati -SkipTrellis
.EXAMPLE
    .\scripts\install-all.ps1 -Steps Images,Engine
.EXAMPLE
    .\scripts\install-all.ps1 -CpuOnly -SkipTrellis
.EXAMPLE
    .\scripts\install-all.ps1 -ListSteps
#>
[CmdletBinding()]
param(
    [string]$Select = '',
    [switch]$SkipModels,
    [switch]$SkipEngine,
    [switch]$SkipTrellis,
    [switch]$SkipBonsai,
    [string[]]$Steps = @(),
    [switch]$ListSteps,
    [switch]$NoClone,
    [switch]$CpuOnly,
    [string]$BonsaiRepo = 'https://github.com/PrismML-Eng/Bonsai-Image-Demo.git'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
$PsExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $PsExe)) { $PsExe = 'powershell.exe' }

# Alias storici dei passi (compatibilita'): 'Bonsai' = vecchio nome di Images.
$StepAlias = @{ 'Bonsai' = 'Images' }
$Steps = @($Steps | ForEach-Object { if ($StepAlias.ContainsKey($_)) { $StepAlias[$_] } else { $_ } })

# ---------------------------------------------------------------- registry passi
# Un solo punto di verita': nome -> @{ Label; Optional; Skip }.
# Aggiungere un passo = una riga qui + una funzione Install-<Nome>.
$StepRegistry = [ordered]@{
    'Prereqs' = @{ Label = 'prerequisiti (node, uv, git)'; Optional = $false; Skipped = $false }
    'Images'  = @{ Label = 'venv images (Py3.11 + torch CUDA, ~5 GB)'; Optional = $false; Skipped = [bool]$SkipBonsai }
    'Engine'  = @{ Label = 'engine sd-cpp + llama.cpp + build della UI'; Optional = $false; Skipped = [bool]$SkipEngine }
    'Models'  = @{ Label = 'modelli in models/'; Optional = $false; Skipped = [bool]$SkipModels }
    'Trellis' = @{ Label = 'venv TRELLIS.2 per il 3D (~25 GB totali, solo pagina /3D)'; Optional = $true; Skipped = ([bool]$SkipTrellis -or [bool]$CpuOnly) }
}

function Step($n, $m) { Write-Host "`n[$n] $m" -ForegroundColor Magenta }
function Info($m)      { Write-Host "      $m" -ForegroundColor Cyan }
function Ok($m)        { Write-Host "      $m" -ForegroundColor Green }
function Warn($m)      { Write-Host "      $m" -ForegroundColor Yellow }

function Test-StepEnabled([string]$Name) {
    if ($Steps.Count -gt 0) { return $Steps -contains $Name }
    return -not $StepRegistry[$Name].Skipped
}

# Esegue uno script figlio isolato e fallisce con un messaggio azionabile.
function Invoke-Script([string]$RelPath, [string]$StepName, [string[]]$ExtraArgs = @()) {
    $path = Join-Path $Root ($RelPath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path)) {
        $hint = switch ($StepName) {
            'Images'  { "reference/ e' ignorata da git (.gitignore): clona con`n      git clone $BonsaiRepo reference\bonsai`n    oppure rilancia con -SkipBonsai / -Steps senza Images" }
            'Trellis' { 'scripts\setup-trellis.ps1 manca: fai git pull oppure rilancia con -SkipTrellis' }
            default   { 'fai git pull per ripristinare lo script, oppure usa -Steps per saltare il passo' }
        }
        throw "[$StepName] manca lo script: $path`n$hint"
    }
    & $PsExe -NoProfile -ExecutionPolicy Bypass -File $path @ExtraArgs
    if ($LASTEXITCODE -ne 0) { throw "[$StepName] $RelPath e' uscito con codice $LASTEXITCODE" }
}

function Ensure-ImagesRepo {
    # reference/ e' esterna e git-ignorata: su clone fresco non esiste.
    # La procuriamo qui invece di crashare con "manca lo script".
    # (Il percorso resta reference\bonsai: e' il repo esterno che fornisce
    # setup.ps1; il nome utente del passo e' "venv images".)
    $dir   = Join-Path $Root 'reference\bonsai'
    $setup = Join-Path $dir 'setup.ps1'
    if (Test-Path -LiteralPath $setup) { return }
    if ($NoClone) {
        throw "[Images] manca $setup e -NoClone attivo.`n" + `
              "Clona a mano: git clone $BonsaiRepo reference\bonsai`n" + `
              "oppure rilancia con -SkipBonsai"
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "[Images] manca $setup e git non e' nel PATH.`n" + `
              "Installa git, oppure clona a mano: git clone $BonsaiRepo reference\bonsai`n" + `
              "oppure rilancia con -SkipBonsai"
    }
    Info "reference\bonsai assente (cartella esterna, non versionata): clono da $BonsaiRepo"
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'reference') | Out-Null
    & git clone $BonsaiRepo $dir
    if ($LASTEXITCODE -ne 0) { throw '[Images] git clone fallito (exit $LASTEXITCODE)' }
    if (-not (Test-Path -LiteralPath $setup)) { throw "[Images] clone ok ma $setup non esiste" }
    Ok 'repo immagini clonato'
}

if ($ListSteps) {
    Write-Host 'Passi disponibili:' -ForegroundColor White
    foreach ($k in $StepRegistry.Keys) {
        $opt = if ($StepRegistry[$k].Optional) { '(opzionale)' } else { '' }
        Write-Host ("  {0,-10} {1} {2}" -f $k, $StepRegistry[$k].Label, $opt)
    }
    exit 0
}
if ($Steps.Count -gt 0) {
    foreach ($s in $Steps) {
        if (-not $StepRegistry.Contains($s)) { throw "Passo sconosciuto: '$s'. Usa -ListSteps." }
    }
}

Write-Host '============================================================' -ForegroundColor White
Write-Host '  PALAMEDE - installazione' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White
Info ("root: " + $Root)

# ---------------------------------------------------------------- Install-<Nome>
function Install-Prereqs {
    foreach ($cmd in @('node', 'uv')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            throw ("[$cmd] Manca '{0}' nel PATH. " -f $cmd) + `
                  "Node.js >= 20: https://nodejs.org - uv: https://docs.astral.sh/uv/"
        }
        Info ("{0} : {1}" -f $cmd, (Get-Command $cmd).Source)
    }
}

# Dipendenze leggere del modelserver (bastano per zimage/klein/qwenimage su CPU;
# il modello bonsai richiede in piu' lo stack GPU installato dal setup esterno).
$LightDeps = @('fastapi', 'uvicorn', 'pydantic', 'numpy')

function Ensure-LightDeps([string]$VenvPy) {
    $missing = & $VenvPy -c "import importlib.util as u; print(' '.join(m for m in ('fastapi','uvicorn','pydantic','numpy') if u.find_spec(m) is None))" 2>$null
    if ($LASTEXITCODE -ne 0) { $missing = 'fastapi uvicorn pydantic numpy' }
    $missing = ($missing | Out-String).Trim()
    if ($missing) {
        Info "installo dipendenze leggere nel venv images: $missing"
        & uv pip install --python $VenvPy $missing.Split(' ')
        if ($LASTEXITCODE -ne 0) { throw '[Images] uv pip install fallito (exit $LASTEXITCODE)' }
    }
}

function Install-Images {
    $ImagesPy = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $ImagesPy) {
        if ($CpuOnly) { Ensure-LightDeps $ImagesPy }
        else { Ok 'gia'' presente, salto'; return }
    } else {
        Ensure-ImagesRepo
        if ($CpuOnly) {
            # niente torch/triton/gemlite/hqq (~5 GB risparmiati) e niente pesi:
            # il venv serve solo come runtime leggero del modelserver.
            $env:BONSAI_SKIP_GPU_STACK = '1'
            $env:SKIP_DOWNLOAD = '1'
            try {
                Invoke-Script 'reference/bonsai/setup.ps1' 'Images'
            } finally {
                Remove-Item Env:\BONSAI_SKIP_GPU_STACK -ErrorAction SilentlyContinue
                Remove-Item Env:\SKIP_DOWNLOAD -ErrorAction SilentlyContinue
            }
            Ensure-LightDeps $ImagesPy
        } else {
            Invoke-Script 'reference/bonsai/setup.ps1' 'Images'
        }
        if (-not (Test-Path -LiteralPath $ImagesPy)) {
            throw '[Images] setup.ps1 ha terminato ma ' + $ImagesPy + ' non esiste'
        }
    }
    if ($CpuOnly) { Ok 'venv images pronto (solo CPU: bonsai non selezionabile)' }
    else { Ok 'venv images pronto' }
}

function Install-Engine {
    $eargs = @()
    if ($CpuOnly) { $eargs += @('-CpuOnly') }
    Invoke-Script 'scripts/setup.ps1' 'Engine' $eargs
    foreach ($need in @('tools\sd-cpp\sd-server.exe', 'tools\llama-cpp\llama-server.exe', 'frontend\dist\index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $need))) { throw "[Engine] setup.ps1 ha terminato ma manca $need" }
    }
    Ok 'engine e UI pronti'
}

function Install-Models {
    $ModelsDir = Join-Path $Root 'models'
    $hasModels = (Test-Path -LiteralPath $ModelsDir) -and
                 (@(Get-ChildItem -LiteralPath $ModelsDir -Directory -ErrorAction SilentlyContinue).Count -gt 0)
    if ($hasModels -and -not $Select) {
        Ok 'modelli gia'' presenti, salto (usa -Select consigliati|tutti|1,3,5 per reinstallare)'
        return
    }
    $margs = @()
    if ($Select) { $margs += @('-Select', $Select) }
    Invoke-Script 'scripts/install-models.ps1' 'Models' $margs
}

function Install-Trellis {
    if ($CpuOnly) { Warn 'TRELLIS richiede CUDA: escluso in modalita'' CPU'; return }
    if (Test-Path -LiteralPath (Join-Path $Root 'reference\trellis-venv\Scripts\python.exe')) {
        Ok 'gia'' presente, salto'; return
    }
    Invoke-Script 'scripts/setup-trellis.ps1' 'Trellis'
}

# ---------------------------------------------------------------- esecuzione
$order = @($StepRegistry.Keys)
$total = @($order | Where-Object { Test-StepEnabled $_ }).Count
$i = 0
foreach ($name in $order) {
    if (-not (Test-StepEnabled $name)) { Warn "[$name] saltato"; continue }
    $i++
    Step "$i/$total $($name)" $StepRegistry[$name].Label
    & "Install-$name"
}

# ---------------------------------------------------------------- esito
Write-Host "`n============================================================" -ForegroundColor White
Write-Host '  RIEPILOGO' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White
$checks = [ordered]@{
    'Images'  = @{ Label = 'venv images (Py3.11)'; Path = 'reference\bonsai\.venv\Scripts\python.exe' }
    'Engine/sd' = @{ Label = 'sd-server (immagini)'; Path = 'tools\sd-cpp\sd-server.exe' }
    'Engine/llama' = @{ Label = 'llama-server (chat)'; Path = 'tools\llama-cpp\llama-server.exe' }
    'Engine/UI' = @{ Label = 'UI compilata'; Path = 'frontend\dist\index.html' }
    'Trellis' = @{ Label = 'venv TRELLIS (3D)'; Path = 'reference\trellis-venv\Scripts\python.exe' }
}
$failed = $false
foreach ($k in $checks.Keys) {
    $stepName = ($k -split '/')[0]
    $optional = $StepRegistry.Contains($stepName) -and $StepRegistry[$stepName].Optional
    $p = Join-Path $Root $checks[$k].Path
    if (Test-Path -LiteralPath $p) { Ok   ("{0,-26} pronto" -f $checks[$k].Label) }
    else {
        Warn ("{0,-26} MANCA ({1})" -f $checks[$k].Label, $checks[$k].Path)
        if (-not $optional) { $failed = $true }
    }
}
if ($failed) { throw "Installazione incompleta: mancano componenti obbligatori (vedi riepilogo)." }
if ($CpuOnly) { Info 'modalita'' CPU attiva: bonsai e TRELLIS non disponibili (richiedono CUDA).' }
Write-Host "`nInstallazione completa. Avvia con start.bat oppure Palamede.exe." -ForegroundColor Green
exit 0
