@echo off
REM ============================================================
REM  Reiniciar credenciales (equivale a: dame click.bat /reset)
REM  Para cuando se escribio mal el usuario o la contrasena del CM o
REM  de SIME: borra las credenciales guardadas en este equipo (archivo
REM  local cifrado), las vuelve a pedir y abre las herramientas.
REM
REM  Vive en scripts\ (lo distribuye empaquetar-release.ps1). Se abre con
REM  doble clic desde esa carpeta. Lanzador DELGADO, como dame click.bat:
REM  toda la logica vive en lanzador.ps1, junto a este archivo. Acepta
REM  los mismos parametros extra, p. ej.:
REM    scripts\reiniciar-credenciales.bat /debug
REM  Para borrar solo una: dame click.bat /resetcm  o  /resetsime
REM ============================================================
@title Reiniciar credenciales
setlocal
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo No se encontro powershell.exe en el PATH.
  pause
  exit /b 1
)
powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0lanzador.ps1" /reset %*
set "CODIGO=%ERRORLEVEL%"
endlocal
exit /b %CODIGO%
