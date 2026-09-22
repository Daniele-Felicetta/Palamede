# Palamede - firma Authenticode dell'exe (dev / OV / EV).
# Uso:
#   .\scripts\sign.ps1 -File .\Palamede.exe
#   .\scripts\sign.ps1 -File .\Palamede.exe -CreateDevCert
#   .\scripts\sign.ps1 -File .\Palamede.exe -Thumbprint ABC123...
#
# Comportamento:
#   - cerca signtool.exe (Windows SDK / VS / PATH)
#   - cerca il cert: -Thumbprint > env PALAMEDE_CERT_THUMBPRINT > cert
#     "CN=Palamede Dev" in CurrentUser\My (e LocalMachine\My)
#   - se non trova nulla: WARN + exit 0 (non rompe la build).
#     Con -CreateDevCert crea un self-signed "CN=Palamede Dev" solo locale.
#     ATTENZIONE: il self-signed serve solo per testare lo script.
#     NON riduce i flag di Kaspersky/SmartScreen sugli altri PC.
#     Per quello serve OV/EV pubblico o Azure Trusted Signing.
#
# Env supportate:
#   PALAMEDE_CERT_THUMBPRINT, PALAMEDE_CERT_SUBJECT (default "Palamede Dev"),
#   PALAMEDE_TIMESTAMP (default http://timestamp.digicert.com)
param(
    [Parameter(Mandatory = $true)]
    [string[]]$File,
    [string]$Thumbprint = $env:PALAMEDE_CERT_THUMBPRINT,
    [string]$Subject = $(if ($env:PALAMEDE_CERT_SUBJECT) { $env:PALAMEDE_CERT_SUBJECT } else { 'Palamede Dev' }),
    [string]$Timestamp = $(if ($env:PALAMEDE_TIMESTAMP) { $env:PALAMEDE_TIMESTAMP } else { 'http://timestamp.digicert.com' }),
    [switch]$CreateDevCert,
    [switch]$Strict
)
$ErrorActionPreference = 'Stop'

function Fail-OrWarn([string]$msg) {
    if ($Strict) { throw $msg }
    Write-Warning $msg
}

function Find-Signtool {
    # 1. PATH
    $cmd = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # 2. vswhere (VS 2017+)
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        try {
            $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools -property installationPath 2>$null | Select-Object -First 1
            if ($vsPath) {
                $cand = Get-ChildItem (Join-Path $vsPath 'MSVC\*') -Directory -ErrorAction SilentlyContinue |
                    ForEach-Object { Join-Path $_.FullName 'bin\Hostx64\x64\signtool.exe' } |
                    Where-Object { Test-Path $_ } | Select-Object -First 1
                if ($cand) { return $cand }
            }
        } catch { }
    }
    # 3. Windows SDK / kits
    foreach ($kit in @($env:WindowsSdkDir, 'C:\Program Files (x86)\Windows Kits\10', 'C:\Program Files\Windows Kits\10')) {
        if (-not $kit) { continue }
        $binRoot = Join-Path $kit 'bin'
        if (-not (Test-Path $binRoot)) { continue }
        $cand = Get-ChildItem $binRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
            Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($cand) { return $cand }
    }
    return $null
}

function Find-CodeSigningCert([string]$tp, [string]$subj) {
    if ($tp) {
        $tp = $tp -replace '\s', ''
        foreach ($store in @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\My')) {
            if (-not (Test-Path $store)) { continue }
            $c = Get-ChildItem $store -ErrorAction SilentlyContinue |
                Where-Object { $_.Thumbprint -eq $tp } | Select-Object -First 1
            if ($c) { return $c }
        }
        return $null
    }
    foreach ($store in @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\My')) {
        if (-not (Test-Path $store)) { continue }
        $c = Get-ChildItem $store -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -like "*$subj*" -and $_.NotAfter -gt (Get-Date) } |
            Sort-Object NotAfter -Descending | Select-Object -First 1
        if ($c) { return $c }
    }
    return $null
}

# --- 0. file esistenti? (se mancano tutti: warn, non rompere la build) ---
$targets = @()
foreach ($f in $File) {
    if (Test-Path $f) { $targets += (Resolve-Path $f).Path }
    else { Write-Warning "file non trovato, salto: $f" }
}
if ($targets.Count -eq 0) {
    Fail-OrWarn 'sign: nessun file da firmare.'
    exit 0
}

# --- 1. signtool ---
$signtool = Find-Signtool
if (-not $signtool) {
    Fail-OrWarn 'sign: signtool.exe non trovato (installa Windows SDK o VS Build Tools). Firma saltata.'
    exit 0
}
Write-Host "signtool: $signtool" -ForegroundColor DarkGray

# --- 2. certificato ---
$cert = Find-CodeSigningCert -tp $Thumbprint -subj $Subject
if (-not $cert -and $CreateDevCert) {
    Write-Host "creo cert dev self-signed 'CN=$Subject' in CurrentUser\My..." -ForegroundColor Yellow
    try {
        $cert = New-SelfSignedCertificate -Type CodeSigningCert `
            -Subject "CN=$Subject" `
            -CertStoreLocation 'Cert:\CurrentUser\My' `
            -KeyExportPolicy Exportable -KeySpec Signature `
            -KeyUsage DigitalSignature -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3') `
            -NotAfter (Get-Date).AddYears(3)
        Write-Host "cert dev creato: $($cert.Thumbprint)" -ForegroundColor Green
        Write-Warning 'Cert self-signed = solo test locale. NON distribuirlo come "soluzione AV".'
    } catch {
        Fail-OrWarn "sign: creazione cert dev fallita: $($_.Exception.Message)"
        exit 0
    }
}
if (-not $cert) {
    Write-Warning 'sign: nessun certificato trovato. Firma saltata.'
    Write-Warning "  Suggerimento: .\scripts\sign.ps1 -File <exe> -CreateDevCert  (solo test locale)"
    Write-Warning '  Oppure imposta $env:PALAMEDE_CERT_THUMBPRINT con il thumbprint OV/EV.'
    exit 0
}
Write-Host "cert: $($cert.Subject) [$($cert.Thumbprint)] scade $($cert.NotAfter.ToString('yyyy-MM-dd'))" -ForegroundColor Cyan

# --- 3. firma ogni file ---
$failed = @()
foreach ($t in $targets) {
    Write-Host "- firmo $t" -ForegroundColor Yellow
    $signArgs = @('sign', '/fd', 'SHA256', '/sha1', $cert.Thumbprint, '/s', 'My')
    if ($Timestamp) { $signArgs += @('/tr', $Timestamp, '/td', 'SHA256') }
    $signArgs += @($t)

    & $signtool @signArgs 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0 -and $Timestamp) {
        Write-Warning "timestamp server non raggiungibile, riprovo senza /tr (firma senza marca temporale)..."
        & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $t 2>&1 | ForEach-Object { Write-Host "  $_" }
    }
    if ($LASTEXITCODE -ne 0) {
        $failed += $t
        Fail-OrWarn "sign: firma fallita per $t"
        continue
    }
    # verifica
    & $signtool verify /pa /v $t 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $sig = Get-AuthenticodeSignature $t
    Write-Host "  stato: $($sig.Status) / $($sig.SignerCertificate.Subject)" -ForegroundColor DarkGray
}

if ($failed.Count -gt 0 -and $Strict) { throw "sign: fallito per $($failed.Count) file." }

$hash = Get-FileHash $targets[0] -Algorithm SHA256
Write-Host "SHA256 ($([System.IO.Path]::GetFileName($targets[0]))): $($hash.Hash)" -ForegroundColor DarkGray
Write-Host '== firma completata (skip se warn sopra) ==' -ForegroundColor Green
