@echo off
rem Palamede — installer dei modelli: scegli cosa scaricare in models/.
rem Doppio clic e segui il menu. Per un elenco senza scaricare:
rem   scripts\install-models.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-models.ps1" %*
pause
