#Requires -Version 5.1
# Wrapper per livekit-wakeword: forza UTF-8 (le stampe contengono emoji) e logga.
param([string]$Cmd = 'export', [string]$Cfg = 'configs/ehi_jarvis_smoke.yaml', [string]$LogTag = 'wake-smoke-export')
$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$Root = 'C:\Users\danie\Desktop\Palamede'
Set-Location (Join-Path $Root 'models\Jarvis\livekit-wakeword')
& (Join-Path $Root 'tools\jarvis-wake\Scripts\livekit-wakeword.exe') $Cmd $Cfg *> (Join-Path $Root "outputs\$LogTag.log")
