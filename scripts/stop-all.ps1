# Ferma hub e modello server (uvicorn + eventuale subprocess sd-server).
$ErrorActionPreference = 'SilentlyContinue'
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like '*hub*server.mjs*' } |
    Stop-Process -Force
Get-Process sd-server -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*uv*' } |
    Stop-Process -Force
Write-Host 'fermati: hub e modello server (bonsai/zimage)' -ForegroundColor Yellow