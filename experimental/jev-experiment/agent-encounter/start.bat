@echo off
rem Start the agent-encounter server using rizzo-flow's environment (Spark + mlx present).
setlocal
set HERE=%~dp0
set PY=%HERE%..\rizzo-flow\.venv\Scripts\python.exe
if not exist "%PY%" (
  echo Non trovo %PY%
  echo Avvia prima rizzo-flow: uv sync --extra cuda --extra test
  exit /b 1
)
"%PY%" "%HERE%run.py" %*
