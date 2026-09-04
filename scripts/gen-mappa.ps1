# Palamede - rigenera l'albero di MAPPA.md dal filesystem.
# Rispetta .gitignore (via git check-ignore), stampa la data di aggiornamento.
# Uso:  .\scripts\gen-mappa.ps1
# NB: script in puro ASCII; i caratteri grafici sono costruiti da codepoint
#     per non dipendere dalla codifica del file su PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Mappa = Join-Path $Root 'MAPPA.md'
if (-not (Test-Path $Mappa)) { throw "MAPPA.md non trovato: $Mappa" }

# voci di livello radice: esclusi git e artefatti di build
$Entries = Get-ChildItem -Force -LiteralPath $Root |
    Where-Object { $_.Name -notin @('.git', 'node_modules', 'target') } |
    Sort-Object @{ Expression = { -not $_.PSIsContainer } }, Name   # dir prima, poi file

$lines = New-Object System.Collections.Generic.List[string]
$date  = Get-Date -Format 'yyyy-MM-dd HH:mm'
$middleDot = [string][char]0x00B7
$branch    = [string][char]0x251C + [string][char]0x2500 + [string][char]0x2500   # |--
$lastGlyph = [string][char]0x2514 + [string][char]0x2500 + [string][char]0x2500   # '--
$lines.Add('```text')
$lines.Add("Palamede/                       (repo git $middleDot aggiornata: $date)")

$i = 0
foreach ($e in $Entries) {
    $i++
    $last  = $i -eq $Entries.Count
    $glyph = if ($last) { $lastGlyph } else { $branch }
    $name  = $e.Name + $(if ($e.PSIsContainer) { '/' } else { '' })
    & git -C $Root check-ignore -q -- $e.Name 2>$null
    $ignored = if ($LASTEXITCODE -eq 0) { '   (gitignored)' } else { '' }
    $lines.Add($glyph + ' ' + $name + $ignored)
}
$lines.Add('```')

$generated = ($lines -join "`n")
$markerStart = '<!-- GEN:ALBERO -->'
$markerEnd   = '<!-- /GEN:ALBERO -->'
$content = Get-Content -Raw -LiteralPath $Mappa -Encoding UTF8
$si = $content.IndexOf($markerStart)
$ei = $content.IndexOf($markerEnd)
if ($si -lt 0 -or $ei -lt 0 -or $ei -le $si) {
    throw "Marcatori $markerStart / $markerEnd mancanti o fuori ordine in MAPPA.md"
}
$head = $content.Substring(0, $si + $markerStart.Length)
$tail = $content.Substring($ei)
$new  = ($head + "`n" + $generated + "`n" + $tail) -replace "`r?`n", "`r`n"
[System.IO.File]::WriteAllText($Mappa, $new, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "MAPPA.md aggiornata: $($Entries.Count) voci $middleDot $date" -ForegroundColor Green