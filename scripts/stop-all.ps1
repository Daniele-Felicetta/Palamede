# Ferma hub e backend (bonsai uvicorn + sd-server).
$ErrorActionPreference = 'SilentlyContinue'
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like '*hub*server.mjs*' } |
    Stop-Process -Force
Get-Process sd-server -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*Palamede*' -or $_.Path -like '*bonsai*' } |
    Stop-Process -Force
Write-Host 'fermati: hub, bonsai, z-image' -ForegroundColor Yellow