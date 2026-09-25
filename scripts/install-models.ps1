# Installer modelli Palamede — scegli cosa scaricare in models/.
# Catalogo: scripts/models.catalog.json (ordine = dal migliore al peggiore,
# giudizi dal Banco di prova). Fonti ufficiali (HuggingFace) o reference/.
#
# Uso:
#   install.bat                                  # interfaccia interattiva
#   .\scripts\install-models.ps1 -List           # mostra il catalogo ed esce
#   .\scripts\install-models.ps1 -Select consigliati   # senza prompt
#   .\scripts\install-models.ps1 -Select "1,3,5"
#   .\scripts\install-models.ps1 -DryRun         # mostra cosa farebbe, non scarica
param(
    [string]$Select = '',
    [switch]$List,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$CatalogPath = Join-Path $Root 'scripts\models.catalog.json'
$Py = Join-Path $Root 'reference\bonsai\.venv\Scripts\python.exe'
$Audit = Join-Path $Root 'experimental\model-antivirus\audit-model.py'

if (-not (Test-Path $CatalogPath)) { throw "manca il catalogo: $CatalogPath" }
$Catalog = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 | ConvertFrom-Json

$LabelText = @{ 'consigliato' = 'CONSIGLIATO'; 'alternativa' = 'ALTERNATIVA'; 'sconsigliato' = 'SCONSIGLIATO' }
$LabelColor = @{ 'consigliato' = 'Green'; 'alternativa' = 'Yellow'; 'sconsigliato' = 'DarkGray' }

# ── helpers ──────────────────────────────────────────────────────────────
function To-Abs([string]$rel) { Join-Path $Root ($rel -replace '/', '\') }
function GB([double]$b) { '{0:N1} GB' -f ($b / 1GB) }
function Pad([string]$s, [int]$w) {
    if ($null -eq $s) { $s = '' }
    if ($s.Length -ge $w) { return $s.Substring(0, $w) }
    return $s + (' ' * ($w - $s.Length))
}
function Write-Seg([string]$t, [string]$fg, [string]$bg) {
    if ($bg) { Write-Host $t -ForegroundColor $fg -BackgroundColor $bg -NoNewline }
    else { Write-Host $t -ForegroundColor $fg -NoNewline }
}

function Get-ModelStatus($model) {
    $required = @($model.files | Where-Object { -not $_.optional })
    $present = 0; $downloadable = $true; $manual = 0
    foreach ($f in $required) {
        if (Test-Path (To-Abs $f.dest)) { $present++ }
        elseif ($f.manual) { $manual++ }
        if (-not ($f.url -or $f.copy -or $f.copyDir)) { $downloadable = $false }
    }
    $total = $required.Count
    if ($present -eq $total) { return 'installato' }
    if ($present -gt 0) { return "parziale ($present/$total)" }
    if ($manual -gt 0 -and -not $downloadable) { return "manuale ($manual)" }
    return 'da scaricare'
}
function Status-Icon([string]$s) {
    if ($s -eq 'installato') { return '✓' }
    if ($s -like 'parziale*') { return '◐' }
    if ($s -like 'manuale*') { return '!' }
    return '↓'
}

# ── catalogo appiattito (per la lista interattiva) ───────────────────────
$items = New-Object System.Collections.ArrayList
foreach ($g in $Catalog.groups) {
    foreach ($m in $g.models) { [void]$items.Add([pscustomobject]@{ group = $g.label; model = $m }) }
}
$count = $items.Count
$sel = New-Object bool[] $count

$HeaderW = 62
function Write-Header {
    $top = '  ╭' + ('─' * $HeaderW) + '╮'
    $bot = '  ╰' + ('─' * $HeaderW) + '╯'
    Write-Host $top -ForegroundColor DarkGray
    Write-Seg '  │ ' 'DarkGray' $null
    Write-Seg 'PALAMEDE' 'White' $null
    Write-Seg ' · installer modelli' 'DarkGray' $null
    Write-Seg (Pad '' ($HeaderW - 1 - 28)) 'DarkGray' $null
    Write-Host '│' -ForegroundColor DarkGray
    Write-Host $bot -ForegroundColor DarkGray
}

function Render([int]$cursor) {
    Clear-Host
    Write-Host ''
    Write-Header
    Write-Host ''
    $curGroup = $null
    for ($i = 0; $i -lt $count; $i++) {
        $it = $items[$i]; $m = $it.model
        if ($it.group -ne $curGroup) {
            $curGroup = $it.group
            Write-Host ("  ── " + $curGroup + " " + ('─' * [Math]::Max(2, $HeaderW - 2 - $curGroup.Length))) -ForegroundColor DarkCyan
        }
        $isCur = ($i -eq $cursor)
        $bg = $null; $fgName = 'White'; $fgIdx = 'DarkGray'
        if ($isCur) { $bg = 'DarkCyan'; $fgName = 'White'; $fgIdx = 'Black' }
        $box = if ($sel[$i]) { '[x]' } else { '[ ]' }
        $marker = if ($isCur) { '▸' } else { ' ' }
        Write-Seg ('  ' + $marker + ' ') $(if ($isCur) { 'Yellow' } else { 'DarkGray' }) $bg
        Write-Seg ($box + ' ') $(if ($sel[$i]) { 'Green' } else { 'DarkGray' }) $bg
        Write-Seg (Pad ("$($i + 1).") 4) $fgIdx $bg
        Write-Seg (Pad $m.name 34) $fgName $bg
        Write-Seg (Pad $LabelText[$m.label] 13) $LabelColor[$m.label] $bg
        Write-Seg ("$($m.quality) · $($m.speed)") 'Gray' $bg
        Write-Host ''
        $st = Get-ModelStatus $m
        $detail = "      ~$($m.vram) · $(GB $m.sizeBytes) · $(Status-Icon $st) $st · $($m.role)"
        Write-Host (Pad $detail ($HeaderW + 20)) -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host ('  ' + ('─' * ($HeaderW + 2))) -ForegroundColor DarkGray
    $n = 0; $bytes = 0
    for ($i = 0; $i -lt $count; $i++) { if ($sel[$i]) { $n++; $bytes += $items[$i].model.sizeBytes } }
    Write-Host '  ↑↓ muovi · Spazio seleziona · A tutti · C consigliati · N nessuno' -ForegroundColor DarkGray
    Write-Seg '  Invio installa · Q esci' 'DarkGray' $null
    Write-Host ("       selezionati: $n · ~$(GB $bytes)") -ForegroundColor Cyan
}

function Show-Confirm {
    $chosen = @()
    for ($i = 0; $i -lt $count; $i++) { if ($sel[$i]) { $chosen += $items[$i].model } }
    Clear-Host
    Write-Host ''
    Write-Header
    Write-Host ''
    Write-Host '  Pronti a scaricare:' -ForegroundColor White
    Write-Host ''
    $bytes = 0
    foreach ($m in $chosen) {
        $bytes += $m.sizeBytes
        Write-Seg '   · ' 'DarkGray' $null
        Write-Seg (Pad $m.name 34) 'White' $null
        Write-Host ("[$($LabelText[$m.label])]") -ForegroundColor $LabelColor[$m.label]
    }
    Write-Host ''
    Write-Host ("  Totale: {0} modelli · ~{1} — su disco in models/" -f $chosen.Count, (GB $bytes)) -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Invio installa · B torna indietro · Q esci' -ForegroundColor DarkGray
    return $chosen
}

function Invoke-AuditModel($file, $url) {
    if ((Test-Path $Py) -and (Test-Path $Audit)) {
        & $Py $Audit $file -Source $url --json
        if ($LASTEXITCODE -eq 2) { Remove-Item $file -Force; throw "AUDIT FALLITO: modello respinto ($url)" }
        if ($LASTEXITCODE -eq 3) { Write-Warning "audit: giudice LLM non disponibile, file tenuto (verifiche deterministiche ok)" }
    }
}
function Invoke-Curl($url, $dest) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    curl.exe -L --fail --retry 3 --progress-bar -o $dest $url
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return $code
}
function Install-File($f) {
    $dest = To-Abs $f.dest
    $name = Split-Path $dest -Leaf
    if (Test-Path $dest) { Write-Host "  = $name già presente" -ForegroundColor DarkGray; return }
    if ($f.manual) {
        Write-Host "  ! $name — sorgente da fornire a mano" -ForegroundColor Yellow
        if ($f.hint) { Write-Host "      $($f.hint)" -ForegroundColor DarkGray }
        return
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    if ($f.url) {
        $size = if ($f.sizeBytes) { " ($(GB $f.sizeBytes))" } else { '' }
        Write-Host "  ↓ $name$size" -ForegroundColor Cyan
        if ($DryRun) { return }
        $code = Invoke-Curl $f.url $dest
        if ($code -ne 0) { if (Test-Path $dest) { Remove-Item $dest -Force }; throw "download fallito: $($f.url)" }
        if ($f.sha256) {
            $got = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLower()
            if ($got -ne $f.sha256.ToLower()) {
                Remove-Item $dest -Force
                throw "SHA256 non corrisponde per $name (atteso $($f.sha256), ottenuto $got)"
            }
            Write-Host '    sha256 ok' -ForegroundColor DarkGray
        }
        if ($f.audit) { Invoke-AuditModel $dest $f.url }
        return
    }
    if ($f.copy) {
        $src = To-Abs $f.copy
        Write-Host "  → $name (da $($f.copy))" -ForegroundColor Cyan
        if ($DryRun) { return }
        if (-not (Test-Path $src)) { Write-Warning "manca $($f.copy): salto $name (esegui il setup di reference/)"; return }
        Copy-Item -LiteralPath $src -Destination $dest -Force
        return
    }
    if ($f.copyDir) {
        $src = To-Abs $f.copyDir
        Write-Host "  → $name/ (robocopy da $($f.copyDir))" -ForegroundColor Cyan
        if ($DryRun) { return }
        if (-not (Test-Path $src)) { Write-Warning "manca $($f.copyDir): salto (esegui il setup di reference/)"; return }
        robocopy $src $dest /E /XD .cache /NFL /NDL /NJH /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy fallito ($LASTEXITCODE)" }
    }
}

function Parse-Selection([string]$raw, $map) {
    $raw = $raw.Trim().ToLowerInvariant()
    if ($raw -in @('', 'nessuno', 'n', 'no')) { return @() }
    if ($raw -eq 'tutti' -or $raw -eq 'all') { return @($map.Keys | Sort-Object) }
    if ($raw -eq 'consigliati' -or $raw -eq 'recommended') {
        return @($map.Keys | Where-Object { $map[$_].label -eq 'consigliato' } | Sort-Object)
    }
    $ids = New-Object System.Collections.Generic.List[int]
    foreach ($part in ($raw -split ',')) {
        $p = $part.Trim()
        if ($p -match '^(\d+)-(\d+)$') { for ($k = [int]$Matches[1]; $k -le [int]$Matches[2]; $k++) { $ids.Add($k) } }
        elseif ($p -match '^\d+$') { $ids.Add([int]$p) }
        elseif ($p) { throw "selezione non valida: '$p' (usa numeri, 'consigliati' o 'tutti')" }
    }
    return @($ids | Sort-Object -Unique)
}

function Show-Static {
    Write-Host ''
    Write-Header
    Write-Host ''
    $i = 0
    foreach ($g in $Catalog.groups) {
        Write-Host ("  ── $($g.label) " + ('─' * [Math]::Max(2, $HeaderW - 2 - $g.label.Length))) -ForegroundColor DarkCyan
        Write-Host "     $($g.hint)" -ForegroundColor DarkGray
        foreach ($m in $g.models) {
            $i++
            $st = Get-ModelStatus $m
            Write-Seg (Pad ("   [$i] ") 9) 'DarkGray' $null
            Write-Seg (Pad $m.name 34) 'White' $null
            Write-Seg (Pad $LabelText[$m.label] 13) $LabelColor[$m.label] $null
            Write-Seg (Pad ("$($m.quality) · $($m.speed)") 24) 'Gray' $null
            Write-Host ("$(Status-Icon $st) $st · $(GB $m.sizeBytes)") -ForegroundColor DarkGray
        }
    }
    Write-Host ''
}

function Invoke-Install($chosen) {
    Write-Host ''
    foreach ($m in $chosen) {
        Write-Host ("── " + $m.name) -ForegroundColor White
        foreach ($f in $m.files) { Install-File $f }
        $s = Get-ModelStatus $m
        $scol = if ($s -eq 'installato') { 'Green' } else { 'Gray' }
        Write-Host "   stato: $s" -ForegroundColor $scol
    }
    Write-Host ''
    Write-Host '  Fatto. Modelli in models/:' -ForegroundColor Green
    Get-ChildItem (Join-Path $Root 'models') -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum | ForEach-Object { "    {0:N2} GB totali" -f ($_.Sum / 1GB) }
    Write-Host '  Avvia con: .\scripts\start.ps1   (oppure Palamede.exe)' -ForegroundColor DarkGray
}

# ── main ─────────────────────────────────────────────────────────────────
if ($List) { Show-Static; return }

$interactive = (-not [Console]::IsInputRedirected)

if ($Select -or -not $interactive) {
    # modalità non interattiva: -Select esplicito, oppure input rediretto
    Show-Static
    $map = @{}
    $i = 0
    foreach ($g in $Catalog.groups) { foreach ($m in $g.models) { $i++; $map[$i] = $m } }
    if (-not $Select) {
        Write-Host '  Input non interattivo: usa -Select "1,3,5" | consigliati | tutti' -ForegroundColor Yellow
        return
    }
    $ids = Parse-Selection $Select $map
    if ($ids.Count -eq 0) { Write-Host '  Nessuna selezione. Niente da fare.' -ForegroundColor DarkGray; return }
    $chosen = @($ids | ForEach-Object { $map[$_] } | Where-Object { $_ })
    $bytes = ($chosen | Measure-Object -Property sizeBytes -Sum).Sum
    Write-Host ("  Selezionati {0} modelli · ~{1}" -f $chosen.Count, (GB $bytes)) -ForegroundColor White
    Invoke-Install $chosen
    return
}

# ── interfaccia interattiva ──────────────────────────────────────────────
$cursor = 0
while ($true) {
    Render $cursor
    $key = [Console]::ReadKey($true)
    switch ($key.Key) {
        'UpArrow'   { if ($cursor -gt 0) { $cursor-- } }
        'DownArrow' { if ($cursor -lt $count - 1) { $cursor++ } }
        'Spacebar'  { $sel[$cursor] = -not $sel[$cursor] }
        'A'         { $allOn = -not (@($sel) -notcontains $false); for ($i = 0; $i -lt $count; $i++) { $sel[$i] = -not $allOn } }
        'C'         { for ($i = 0; $i -lt $count; $i++) { $sel[$i] = ($items[$i].model.label -eq 'consigliato') } }
        'N'         { for ($i = 0; $i -lt $count; $i++) { $sel[$i] = $false } }
        'Q'         { Clear-Host; return }
        'Escape'    { Clear-Host; return }
        'Enter'     {
            $any = @($sel) -contains $true
            if (-not $any) { continue }
            $chosen = Show-Confirm
            $k2 = [Console]::ReadKey($true)
            if ($k2.Key -eq 'B' -or $k2.Key -eq 'Backspace') { continue }
            if ($k2.Key -eq 'Q' -or $k2.Key -eq 'Escape') { Clear-Host; return }
            if ($k2.Key -eq 'Enter') { Clear-Host; Invoke-Install $chosen; return }
        }
    }
}
