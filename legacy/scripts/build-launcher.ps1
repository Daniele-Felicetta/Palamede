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

# ── icona multi-size dal PNG (.ico per l'exe e risorsa embedded) ─────────────
$iconPng = Join-Path $Root 'palamede_icon.png'
$iconIco = Join-Path $Root 'palamede_icon.ico'
if (-not (Test-Path $iconPng)) { throw 'palamede_icon.png mancante' }
if (-not (Test-Path $iconIco) -or ($iconPng | Get-Item).LastWriteTime -gt ($iconIco | Get-Item).LastWriteTime) {
    Write-Host 'Genero palamede_icon.ico…' -ForegroundColor Cyan
    Add-Type -AssemblyName System.Drawing
    $sizes = 16, 32, 48, 256
    try {
        $bmpSrc = [System.Drawing.Bitmap]::new($iconPng)
        try {
            # una bitmap ridimensionata per ogni dimensione. Layout A: tutte le
            # entry prima, poi tutti i dati PNG in sequenza (offset calcolati qui).
            $datas   = New-Object System.Collections.Generic.List[byte[]]
            foreach ($sz in $sizes) {
                $bmp = [System.Drawing.Bitmap]::new($bmpSrc, $sz, $sz)
                try {
                    $ms = New-Object System.IO.MemoryStream
                    try {
                        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                        $datas.Add($ms.ToArray())
                    } finally {
                        $ms.Dispose()
                    }
                } finally {
                    $bmp.Dispose()
                }
            }
            $count = $sizes.Count
            $offset = 6 + 16 * $count   # primo dato: dopo header(6) + count entry(16)
            $fs = [System.IO.File]::Create($iconIco)
            try {
                $w = New-Object System.IO.BinaryWriter($fs)
                try {
                    # header ICONDIR: reserved = 0, type = 1 (icon), count
                    $w.Write([UInt16]0)
                    $w.Write([UInt16]1)
                    $w.Write([UInt16]$count)
                    # una ICONDIRENTRY da 16 byte per ogni dimensione
                    for ($i = 0; $i -lt $count; $i++) {
                        $data = $datas[$i]
                        if ($sizes[$i] -eq 256) { $wd = [byte]0 } else { $wd = [byte]$sizes[$i] }
                        $w.Write([byte]$wd)              # width  (0 = 256)
                        $w.Write([byte]$wd)              # height (0 = 256)
                        $w.Write([byte]0)                # colorCount
                        $w.Write([byte]0)                # reserved
                        $w.Write([UInt16]1)              # planes
                        $w.Write([UInt16]32)             # bitCount
                        $w.Write([UInt32]$data.Length)   # bytesInRes
                        $w.Write([UInt32]$offset)        # imageOffset
                        $offset += $data.Length
                    }
                    # dati PNG in sequenza (senza prefisso di lunghezza)
                    foreach ($d in $datas) { $w.Write($d, 0, $d.Length) }
                } finally {
                    $w.Dispose()
                }
            } finally {
                $fs.Dispose()
            }
        } finally {
            $bmpSrc.Dispose()
        }
    }
    catch { throw "Generazione palamede_icon.ico fallita: $_" }
}

$args = @(
    '/nologo', '/target:winexe', '/optimize',
    "/out:$out",
    "/r:$ioZip",
    "/resource:$bundle,Palamede.bundle",
    "/win32icon:$iconIco",
    "/resource:$iconIco,Palamede.icon",
    "/resource:$iconPng,Palamede.png",
    $src
)
& $csc @args
if ($LASTEXITCODE -eq 0) {
    "Launcher compilato: $out ({0:N1} MB, bundle incorporato {1:N0} MB)" -f `
        ((Get-Item $out).Length / 1MB), ((Get-Item $bundle).Length / 1MB)
} else {
    throw "Compilazione fallita (exit $LASTEXITCODE)"
}