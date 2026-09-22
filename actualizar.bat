@echo off
REM ============================================================
REM  Instala la version nueva de me-operacion (si hay una).
REM  Paso APARTE y siempre A MANO: "dame click.bat" solo AVISA si hay
REM  version nueva, nunca la aplica solo. Ver doc/lanzador/README.md.
REM
REM  La logica real vive en scripts\actualizar.ps1 (este .bat solo la
REM  invoca), igual que "dame click.bat" con scripts\lanzador.ps1.
REM
REM  Uso:
REM    actualizar.bat
REM    actualizar.bat /debug
REM    actualizar.bat /sinconfirmar
REM ============================================================
@title Actualizar me-operacion
setlocal
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo No se encontro powershell.exe en el PATH.
  pause
  exit /b 1
)
powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar.ps1" %*
set "CODIGO=%ERRORLEVEL%"
endlocal
exit /b %CODIGO%
