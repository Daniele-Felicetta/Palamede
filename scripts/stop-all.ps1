# Ferma hub, modello server (uvicorn + eventuale subprocess sd-server) e
# server chat (llama.cpp llama-server).
$ErrorActionPreference = 'SilentlyContinue'
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like '*hub*server.mjs*' } |
    Stop-Process -Force
Get-Process sd-server -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*uv*' } |
    Stop-Process -Force
Write-Host 'fermati: hub, modello server (bonsai/zimage) e chat (llama-server)' -ForegroundColor Yellow