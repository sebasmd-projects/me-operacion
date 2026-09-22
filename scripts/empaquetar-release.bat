@echo off
REM ============================================================
REM  Empaqueta la release (version.json + .zip) sin depender de
REM  la ExecutionPolicy de PowerShell del equipo, igual que hace
REM  "dame click.bat" para su propia logica.
REM
REM  Uso:
REM    empaquetar-release.bat
REM      Recomienda Fix/Patch +1 y permite elegir Minor, Major o X.Y.Z.
REM    empaquetar-release.bat -Version 3.0.0 -Notas "que trae"
REM      Uso no interactivo con una version puntual.
REM    empaquetar-release.bat -Incremento Fix|Minor|Major
REM      Uso no interactivo calculado desde scripts\VERSION.
REM ============================================================
setlocal
powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0empaquetar-release.ps1" %*
set "CODIGO=%ERRORLEVEL%"
endlocal
exit /b %CODIGO%
