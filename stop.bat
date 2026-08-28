@echo off
rem Palamede — ferma hub e modello server.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1"
pause