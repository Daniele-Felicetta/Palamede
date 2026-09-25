<#
.SYNOPSIS
    Installa le dipendenze di TRELLIS.2 (pip + native CUDA) nel venv separato
    reference\trellis-venv.

.DESCRIPTION
    Script idempotente che:
      A) installa le dipendenze pip semplici (torchvision, opencv, trimesh, kornia, timm, ...)
         e utils3d da git (fallimento non bloccante).
      B) assicura la submodule Eigen di o-voxel.
      C) compila le estensioni native CUDA (o-voxel, flex_gemm, CuMesh) dentro l'ambiente
         MSVC (VsDevCmd). Una singola compilazione che fallisce NON interrompe lo script.
      D) scarica il decoder Stage1 mancante (ss_dec_conv3d_16l8_fp16) da HuggingFace.

    Alla fine stampa un riepilogo: pip OK, native OK/FAIL, decoder OK.

.PARAMETER SkipPip
    Salta il Passo A (installazioni pip).

.PARAMETER SkipNative
    Salta il Passo C (compilazione CUDA / estensioni native). Utile per testare solo le pip deps.

.NOTES
    PowerShell 5.1. Richiede: uv in PATH, venv Python SEPARATO in
    reference\trellis-venv (Python 3.13 + torch cu130, creato da qui se manca),
    toolchain MSVC Build Tools 2022 e nvcc (per i passi nativi).
#>

[CmdletBinding()]
param(
    [switch]$SkipPip,
    [switch]$SkipNative
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Costanti / percorsi (verificati)
# ---------------------------------------------------------------------------
$RepoRoot        = Split-Path -Parent $PSScriptRoot
# Venv SEPARATO da quello di bonsai (che e' Py3.11 + torch 2.11+cu128 e deve
# restare intatto): TRELLIS gira in reference\trellis-venv (Py3.13 + torch cu130),
# come da hub\lib\root.mjs (TRELLIS_PY) e scripts\start-trellis.ps1.
$VenvDir         = Join-Path $RepoRoot "reference\trellis-venv"
$VenvPython      = Join-Path $VenvDir "Scripts\python.exe"
$TrellisSrcDir   = Join-Path $RepoRoot "models\TRELLIS.2"
$OvoxelDir       = Join-Path $TrellisSrcDir "o-voxel"
$EigenCheck      = Join-Path $OvoxelDir "third_party\eigen"
$CkptsDir        = Join-Path $RepoRoot "models\TRELLIS.2-4B\ckpts"

$VsDevCmd        = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
# CUDA 13.1: torch 2.9.1+cu130 richiede estensioni native con major CUDA 13.
# (lo stesso torch rifiuta estensioni compilate con major 12 e viceversa.)
$CUDAHome        = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.1"

$Utils3dGitUrl   = "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"
$FlexGemmGit     = "https://github.com/JeffreyXiang/FlexGEMM.git"
$CuMeshGit       = "https://github.com/JeffreyXiang/CuMesh.git"

$HfRepo          = "microsoft/TRELLIS-image-large"
$DecoderRelPath  = "ckpts/ss_dec_conv3d_16l8_fp16"   # path remoto dentro il repo HF
$DecoderJson     = Join-Path $CkptsDir "ss_dec_conv3d_16l8_fp16.json"
$DecoderStensors = Join-Path $CkptsDir "ss_dec_conv3d_16l8_fp16.safetensors"

# Nomi dei moduli Python per il controllo "già installato" delle native.
$NativeModules = @{
    "o-voxel"   = "o_voxel"
    "flex_gemm" = "flex_gemm"
    "cumesh"    = "mesh"
}

# ---------------------------------------------------------------------------
# Funzioni di logging
# ---------------------------------------------------------------------------
function Log-Info  { param([string]$m) Write-Host "  [INFO ] $m"   -ForegroundColor Cyan }
function Log-Succ  { param([string]$m) Write-Host "  [ OK  ] $m"   -ForegroundColor Green }
function Log-Warn  { param([string]$m) Write-Host "  [WARN ] $m"   -ForegroundColor Yellow }
function Log-Error { param([string]$m) Write-Host "  [FAIL ] $m"   -ForegroundColor Red }
function Log-Step  { param([string]$m) Write-Host "`n========== $m ==========" -ForegroundColor Magenta }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Test-FileExist {
    param([string]$Path)
    return (Test-Path -LiteralPath $Path)
}

function Get-UvCommand {
    $cmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "uv non trovato in PATH. Installa uv (https://docs.astral.sh/uv/) o aggiungilo al PATH."
}

function Test-ModuleImport {
    # Restituisce $true se `import <module>` riesce nel venv.
    param([string]$Py, [string]$Module)
    try {
        & $Py -Command "import $Module" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Invoca VsDevCmd.bat in una sessione cmd figlia e restituisce il path del batch
# di build pronto ad essere eseguito. L'ambiente MSVC (PATH per cl.exe, ecc.)
# deve vivere nella stessa sessione cmd delle installazioni pip.
# ---------------------------------------------------------------------------
function Get-VsBuildEnv {
    param([string]$Command)
    if (-not (Test-FileExist $VsDevCmd)) { return $null }
    # Costruisce un .bat che: carica l'ambiente MSVC, imposta CUDA_HOME/CUDA_PATH,
    # poi esegue il comando passato. Il comando viene scritto come singola riga.
    $tmpBat = Join-Path ([System.IO.Path]::GetTempPath()) ("trellis_vsbuild_{0}.bat" -f [guid]::NewGuid().ToString('N'))
    $content = @(
        "@echo off",
        "call `"$VsDevCmd`" -arch=amd64 -host_arch=amd64",
        "set CUDA_HOME=$CUDAHome",
        "set CUDA_PATH=$CUDAHome",
        "set DISTUTILS_USE_SDK=1",
        $Command
    )
    Set-Content -LiteralPath $tmpBat -Value $content -Encoding ASCII
    return $tmpBat
}

# ---------------------------------------------------------------------------
# Compila/installa una estensione native dentro l'ambiente MSVC.
# Se il modulo Python è già importabile, salta la compilazione.
# Restituisce "OK" o "FAIL".
# ---------------------------------------------------------------------------
function Invoke-NativeBuild {
    param(
        [string]$Name,
        [string]$Path
    )

    $mod = $NativeModules[$Name]
    if (Test-ModuleImport -Py $VenvPython -Module $mod) {
        Log-Succ ("{0}: modulo '{1}' già importabile -> compilazione saltata." -f $Name, $mod)
        return "OK"
    }

    # Verifica che il setup.py esista.
    if (-not (Test-FileExist (Join-Path $Path "setup.py"))) {
        Log-Error ("{0}: setup.py non trovato in: {1}" -f $Name, $Path)
        return "FAIL"
    }

    # Se serve MSVC ma non c'è VsDevCmd, tentiamo comunque con pip del venv.
    if (Test-FileExist $VsDevCmd) {
        Log-Info ("{0}: compilazione dentro l'ambiente MSVC (VsDevCmd amd64)." -f $Name)
        $cmd = "call `"$Uv`" pip install --python `"$VenvPython`" `"$Path`" --no-build-isolation"
        $bat = Get-VsBuildEnv -Command $cmd
        try {
            # esegue il .bat (carica MSVC + installa). Il path può contenere spazi.
            & cmd.exe /d /c "`"$bat`""
            if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
            Log-Succ ("{0}: compilato/installato con successo." -f $Name)
            return "OK"
        } catch {
            Log-Error ("{0}: fallita la compilazione ({1})." -f $Name, $_.Exception.Message)
            return "FAIL"
        } finally {
            Remove-Item -LiteralPath $bat -Force -ErrorAction SilentlyContinue
        }
    } else {
        Log-Warn ("{0}: VsDevCmd non trovato -> tentativo con pip del venv." -f $Name)
        try {
            & $Uv pip install --python $VenvPython "$Path" --no-build-isolation 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
            Log-Succ ("{0}: installato con pip del venv." -f $Name)
            return "OK"
        } catch {
            Log-Error ("{0}: fallita la compilazione ({1})." -f $Name, $_.Exception.Message)
            return "FAIL"
        }
    }
}

# ---------------------------------------------------------------------------
# Verifica prerequisiti di base
# ---------------------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor White
Write-Host "  TRELLIS.2 setup" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor White

if (-not (Test-FileExist $VenvPython)) {
    Log-Warn "Venv TRELLIS assente, lo creo in: $VenvDir"
    $Uv0 = Get-UvCommand
    & $Uv0 venv $VenvDir --python 3.13
    if ($LASTEXITCODE -ne 0 -or -not (Test-FileExist $VenvPython)) {
        throw "Impossibile creare il venv TRELLIS in $VenvDir (serve uv + Python 3.13)."
    }
    Log-Succ "Venv TRELLIS creato (Python 3.13)."
}
$Uv = Get-UvCommand
Log-Info "Venv TRELLIS : $VenvPython"
Log-Info "uv           : $Uv"

# ---------------------------------------------------------------------------
# Passo A — Dipendenze pip semplici + utils3d
# ---------------------------------------------------------------------------
if (-not $SkipPip) {
    Log-Step "PASSO A: dipendenze pip (torchvision, opencv, trimesh, kornia, timm, zstandard, ...)"

    $PipSimple = @(
        "torchvision",
        "opencv-python-headless",
        "imageio",
        "trimesh",
        "easydict",
        "kornia",
        "timm",
        "zstandard"
    )

    try {
        Log-Info "Installazione pacchetti semplici: $($PipSimple -join ', ')"
        # NB: torchvision DEVE restare allineato alla build CUDA del torch del
        # venv TRELLIS (2.9.1+cu130). Senza --index-url cu130, uv risolverebbe
        # una build torch CPU e romperebbe la pipeline 3D.
        & $Uv pip install --python $VenvPython --index-url https://download.pytorch.org/whl/cu130 `
            "torch==2.9.1+cu130" "torchvision==0.24.1+cu130" @PipSimple
        if ($LASTEXITCODE -ne 0) { throw "uv pip install (pacchetti semplici) exit code $LASTEXITCODE" }
        Log-Succ "Pacchetti semplici installati (torch 2.9.1+cu130 preservato)."
    } catch {
        Log-Error ("Errore durante l'installazione dei pacchetti semplici: {0}" -f $_.Exception.Message)
    }

    # utils3d da git — fallimento NON bloccante.
    try {
        Log-Info "Installazione utils3d da git: $Utils3dGitUrl"
        & $Uv pip install --python $VenvPython ("utils3d @ {0}" -f $Utils3dGitUrl)
        if ($LASTEXITCODE -ne 0) { throw "uv pip install (utils3d) exit code $LASTEXITCODE" }
        Log-Succ "utils3d installato."
    } catch {
        Log-Warn ("NON bloccante: utils3d non installato ({0}). Verifica la raggiungibilità del git remote." -f $_.Exception.Message)
    }
} else {
    Log-Warn "Passo A saltato (-SkipPip)."
}

# ---------------------------------------------------------------------------
# Passo B — Submodule Eigen di o-voxel
# ---------------------------------------------------------------------------
Log-Step "PASSO B: submodule Eigen di o-voxel"
if (-not (Test-FileExist $EigenCheck)) {
    Log-Warn "Eigen non trovato in: $EigenCheck"
    Log-Info "Tentativo di inizializzazione submodule dentro: $TrellisSrcDir"
    try {
        Push-Location $TrellisSrcDir
        git submodule update --init --recursive
        if ($LASTEXITCODE -ne 0) { throw "git submodule update exit code $LASTEXITCODE" }
        Pop-Location
        if (Test-FileExist $EigenCheck) { Log-Succ "Submodule Eigen inizializzata." }
        else { Log-Warn "La submodule Eigen non è apparsa dopo 'git submodule update --init --recursive'." }
    } catch {
        Log-Warn ("NON bloccante: impossibile inizializzare le submodule ({0}). 'git submodule update --init --recursive' potrebbe richiedere accesso alla rete / git installato." -f $_.Exception.Message)
        Pop-Location -ErrorAction SilentlyContinue
    }
} else {
    Log-Succ "Eigen già presente in: $EigenCheck"
}

# ---------------------------------------------------------------------------
# Passo C — Compilazione native CUDA (o-voxel, flex_gemm, CuMesh)
# ---------------------------------------------------------------------------
$NativeResults = @{}

if (-not $SkipNative) {
    Log-Step "PASSO C: compilazione estensioni native CUDA (o-voxel, flex_gemm, cumesh)"

    if (-not (Test-FileExist $VsDevCmd)) {
        Log-Error "VsDevCmd.bat non trovato in: $VsDevCmd"
        Log-Warn "Impossibile compilare le estensioni native con MSVC. Procedo comunque (tentativi con pip del venv)."
    } else {
        # Verifica preliminare Eigen prima di compilare o-voxel.
        if (-not (Test-FileExist $EigenCheck)) {
            Log-Error "Eigen manca ancora: $EigenCheck"
            Log-Warn "Prima di ricompilare, esegui 'git submodule update --init --recursive' in models\TRELLIS.2"
        }

        # 1) o-voxel — path locale nel repo.
        $NativeResults["o-voxel"] = Invoke-NativeBuild -Name "o-voxel" -Path $OvoxelDir

        # 2) flex_gemm e CuMesh — clonati in una cartella temporanea.
        try {
            $TempGit = Join-Path ([System.IO.Path]::GetTempPath()) "trellis_native_src"
            if (-not (Test-FileExist $TempGit)) { New-Item -ItemType Directory -Force -Path $TempGit | Out-Null }

            # flex_gemm
            $FlexGemmDir = Join-Path $TempGit "FlexGEMM"
            if (-not (Test-FileExist (Join-Path $FlexGemmDir "setup.py"))) {
                Log-Info "Clone di FlexGEMM..."
                Push-Location $TempGit
                git clone --depth 1 $FlexGemmGit $FlexGemmDir
                Pop-Location
            }
            if (Test-FileExist (Join-Path $FlexGemmDir "setup.py")) {
                $NativeResults["flex_gemm"] = Invoke-NativeBuild -Name "flex_gemm" -Path $FlexGemmDir
            } else {
                $NativeResults["flex_gemm"] = "FAIL"
                Log-Error "FlexGEMM clonato ma setup.py non trovato in: $FlexGemmDir"
            }

            # CuMesh
            $CuMeshDir = Join-Path $TempGit "CuMesh"
            if (-not (Test-FileExist (Join-Path $CuMeshDir "setup.py"))) {
                Log-Info "Clone di CuMesh..."
                Push-Location $TempGit
                git clone --depth 1 $CuMeshGit $CuMeshDir
                Pop-Location
            }
            if (Test-FileExist (Join-Path $CuMeshDir "setup.py")) {
                $NativeResults["cumesh"] = Invoke-NativeBuild -Name "cumesh" -Path $CuMeshDir
            } else {
                $NativeResults["cumesh"] = "FAIL"
                Log-Error "CuMesh clonato ma setup.py non trovato in: $CuMeshDir"
            }
        } catch {
            Log-Warn ("NON bloccante: errore durante clone/compilazione flex_gemm/cumesh ({0})." -f $_.Exception.Message)
            if (-not $NativeResults.ContainsKey("flex_gemm")) { $NativeResults["flex_gemm"] = "FAIL" }
            if (-not $NativeResults.ContainsKey("cumesh"))    { $NativeResults["cumesh"]    = "FAIL" }
        }
    }
} else {
    Log-Warn "Passo C saltato (-SkipNative)."
}

# ---------------------------------------------------------------------------
# Passo D — Decoder Stage1 mancante (ss_dec_conv3d_16l8_fp16)
# ---------------------------------------------------------------------------
Log-Step "PASSO D: download decoder Stage1 ss_dec_conv3d_16l8_fp16"
$DecoderOk = $true

foreach ($f in @(@{ Path = $DecoderJson;     Ext = ".json" }, @{ Path = $DecoderStensors; Ext = ".safetensors" })) {
    if (Test-FileExist $f.Path) {
        Log-Succ "Presente: $($f.Path)"
    } else {
        $DecoderOk = $false
        $Url = "https://huggingface.co/{0}/resolve/main/{1}" -f $HfRepo, ($DecoderRelPath + $f.Ext)
        Log-Info "Download in corso: $($f.Path)"
        try {
            if (-not (Test-FileExist $CkptsDir)) { New-Item -ItemType Directory -Force -Path $CkptsDir | Out-Null }
            Invoke-WebRequest -Uri $Url -OutFile $f.Path -UseBasicParsing -UserAgent "trellis-setup"
            if (-not (Test-FileExist $f.Path) -or (Get-Item $f.Path).Length -eq 0) {
                throw "File scaricato vuoto o inesistente."
            }
            Log-Succ "Scaricato: $($f.Path)"
        } catch {
            # Fallback via huggingface_hub nel venv: hf_hub_download salva nella
            # cache HF; copiamo poi il file nella destinazione voluta ($CkptsDir).
            try {
                Log-Info "Fallback via huggingface_hub..."
                # Passa il codice come singolo -Command; dentro Python usiamo
                # argv per evitare problemi di quoting PowerShell con i path.
                $hfName = Split-Path -Leaf $f.Path
                $code = "from huggingface_hub import hf_hub_download; print(hf_hub_download('$HfRepo', '$($DecoderRelPath)$($f.Ext)'))"
                $cached = & $VenvPython -Command $code 2>$null
                $cached = ($cached | Select-Object -Last 1).Trim()
                if (-not $cached -or -not (Test-Path -LiteralPath $cached)) {
                    throw "hf_hub_download non ha restituito un file valido."
                }
                Copy-Item -LiteralPath $cached -Destination $f.Path -Force
                if (-not (Test-FileExist $f.Path) -or (Get-Item $f.Path).Length -eq 0) {
                    throw "Copia nella destinazione non riuscita."
                }
                Log-Succ "Scaricato via HF: $($f.Path)"
            } catch {
                Log-Error ("Impossibile scaricare $($f.Path) ({0}). Verifica accesso alla rete / autenticazione HF." -f $_.Exception.Message)
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Riepilogo finale
# ---------------------------------------------------------------------------
Log-Step "RIEPILOGO FINALE"

Write-Host ""
Write-Host "  Dipendenze pip .............. (Passo A)" -ForegroundColor Gray
if ($SkipPip) { Write-Host "    Saltate (-SkipPip)."        -ForegroundColor Yellow }
else {
    $pipSimpleOk = Test-ModuleImport -Py $VenvPython -Module "torchvision"
    if ($pipSimpleOk) { Write-Host "    torchvision : OK (importabile)"            -ForegroundColor Green }
    else              { Write-Host "    torchvision : MANCANTE/da verificare"        -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "  Estensioni native ........... (Passo C)" -ForegroundColor Gray
foreach ($k in $NativeResults.Keys | Sort-Object) {
    $v = $NativeResults[$k]
    if ($v -eq "OK") { Write-Host ("    {0,-12} : OK"        -f $k) -ForegroundColor Green }
    else             { Write-Host ("    {0,-12} : FAIL ({1})" -f $k, $v) -ForegroundColor Red }
}
if ($SkipNative) { Write-Host "    Saltate (-SkipNative)."   -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Decoder Stage1 ................ (Passo D)" -ForegroundColor Gray
if ($DecoderOk) { Write-Host "    ss_dec_conv3d_16l8_fp16 : OK" -ForegroundColor Green }
else            { Write-Host "    ss_dec_conv3d_16l8_fp16 : MANCANTE" -ForegroundColor Yellow }

Write-Host ""
Write-Host "============================================================" -ForegroundColor White
if (($DecoderOk) -and (-not $SkipNative)) {
    $anyFail = ($NativeResults.Values | Where-Object { $_ -ne "OK" })
    if ($anyFail) {
        Write-Host "  Completato con AVVERTENZE: alcune estensioni native non sono state compilate." -ForegroundColor Yellow
    } else {
        Write-Host "  Tutte le dipendenze di TRELLIS.2 risultano pronte." -ForegroundColor Green
    }
} elseif (-not $SkipNative) {
    Write-Host "  Completato con AVVERTENZE." -ForegroundColor Yellow
} else {
    Write-Host "  Fatto (skip pip e/o native)." -ForegroundColor Yellow
}
Write-Host "============================================================" -ForegroundColor White
