# Compila il launcher Palamede.exe (root) con csc.exe del .NET Framework
# incluso in Windows: nessuna dipendenza esterna, nessun install.
# Rilanciare dopo eventuali modifiche a launcher/PalamedeLauncher.cs.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe del .NET Framework non trovato' }

$src = Join-Path $Root 'launcher\PalamedeLauncher.cs'
$out = Join-Path $Root 'Palamede.exe'

& $csc /nologo /target:winexe /optimize /out:$out $src
if ($LASTEXITCODE -eq 0) {
    "Launcher compilato: $out ({0:N0} KB)" -f ((Get-Item $out).Length / 1KB)
} else {
    throw "Compilazione fallita (exit $LASTEXITCODE)"
}