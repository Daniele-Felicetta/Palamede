# Compila il launcher Palamede.exe (root) con csc.exe del .NET Framework
# incluso in Windows: nessuna dipendenza esterna, nessun install.
# Incorpora palamede.bundle (frontend + hub + backends + llama.cpp) come
# risorsa: l'exe estrae il codice al primo avvio e tutto "vive nell'exe".
#
# Uso:  .\scripts\build-launcher.ps1
#       (richiede palamede.bundle: esegui prima scripts/build-bundle.ps1)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe del .NET Framework non trovato' }

$src    = Join-Path $Root 'launcher\PalamedeLauncher.cs'
$out    = Join-Path $Root 'Palamede.exe'
$bundle = Join-Path $Root 'palamede.bundle'
$ioZip  = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.dll'

if (-not (Test-Path $bundle)) { throw 'palamede.bundle mancante: esegui scripts/build-bundle.ps1' }

$args = @(
    '/nologo', '/target:winexe', '/optimize',
    "/out:$out",
    "/r:$ioZip",
    "/resource:$bundle,Palamede.bundle",
    $src
)
& $csc @args
if ($LASTEXITCODE -eq 0) {
    "Launcher compilato: $out ({0:N1} MB, bundle incorporato {1:N0} MB)" -f `
        ((Get-Item $out).Length / 1MB), ((Get-Item $bundle).Length / 1MB)
} else {
    throw "Compilazione fallita (exit $LASTEXITCODE)"
}