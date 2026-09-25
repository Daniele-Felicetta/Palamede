# Ferma hub, modello server (uvicorn + eventuale subprocess sd-server),
# server 3D TRELLIS, chat/rerank (llama-server) e JEV Hub.
$ErrorActionPreference = 'SilentlyContinue'

function Get-CmdLine([int]$procId) {
    (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine
}

# hub (:4600) e JEV Hub (:4610): processi node con server.mjs nel comando
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { (Get-CmdLine $_.Id) -like '*hub*server.mjs*' } |
    Stop-Process -Force

# motori C++ (sd-server per bonsai/zimage/klein/qwen-image, llama-server chat+rerank)
Get-Process sd-server -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force

# backend Python (modelserver, trellis, wan) avviati dai venv in reference/
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object {
        $cl = Get-CmdLine $_.Id
        $cl -like '*backends.modelserver*' -or
        $cl -like '*backends.trellis_server*' -or
        $cl -like '*backends.wan_server*'
    } |
    Stop-Process -Force

Write-Host 'fermati: hub, modello server (bonsai/zimage/klein/qwen-image), 3D, chat/rerank e JEV Hub' -ForegroundColor Yellow
