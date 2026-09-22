@echo off
REM ============================================================
REM  Abrir herramientas SIME / CM-BSS
REM  Coloca este .bat junto a index.html (la carpeta que contiene
REM  'herramientas', 'assets' y 'scripts\lanzador.ps1').
REM
REM  Lanzador DELGADO: toda la logica vive en scripts\lanzador.ps1,
REM  invocado como archivo real -no como bloque embebido que el propio
REM  .bat decodifica y ejecuta con Invoke-Expression, como antes-. Ese
REM  patron ("el script se lee a si mismo y corre el resultado") es una
REM  firma que varios antivirus vigilan de cerca, asi que se evita por
REM  completo. De paso, lanzador.ps1 SI se puede firmar con Authenticode;
REM  un .bat no se puede firmar de ninguna forma.
REM
REM  A proposito, en la raiz del proyecto solo quedan tres archivos
REM  "externos": index.html, este .bat y actualizar.bat. Todo lo demas
REM  -logica, scripts, documentacion- vive en assets\, scripts\ y doc\.
REM
REM  Uso: ver el encabezado de scripts\lanzador.ps1 para el detalle
REM  completo de parametros (/solo-casos, /sinsesion, /reset, /debug,
REM  /sinupdate...).
REM
REM  Aviso de version nueva: este lanzador SOLO avisa si hay una version
REM  mas nueva publicada; nunca la descarga ni la aplica solo. Para
REM  instalarla, corre "actualizar.bat" aparte (paso siempre a mano).
REM ============================================================
@title Herramientas SIME / CM
setlocal
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo No se encontro powershell.exe en el PATH.
  pause
  exit /b 1
)
powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0scripts\lanzador.ps1" %*
set "CODIGO=%ERRORLEVEL%"
endlocal
exit /b %CODIGO%
