@echo off
rem Palamede - installer unico: prepara tutto (venv, engine, UI, modelli, 3D).
rem Doppio clic e segui la console. Solo i modelli:
rem   scripts\install-models.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-all.ps1" %*
pause
