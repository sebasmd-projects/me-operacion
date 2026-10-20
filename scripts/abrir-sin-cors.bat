@echo off
setlocal EnableExtensions
title Abrir sin CORS
rem =====================================================================
rem  abrir-sin-cors.bat  (plantilla: el original vive en me-operacion\scripts)
rem  ---------------------------------------------------------------------
rem  Abre una pagina HTML local en Microsoft Edge SIN la politica de CORS,
rem  igual que "dame click.bat" de me-operacion: perfil temporal propio,
rem  --disable-web-security y --allow-file-access-from-files.
rem
rem  Que abre (en la carpeta donde esta este .bat):
rem    1. index.html, si existe.
rem    2. Si no, el unico .html de la carpeta.
rem    3. Si hay varios, muestra la lista para escoger uno.
rem
rem  Uso: copia este archivo a la carpeta de la OTRA herramienta y dale
rem  doble clic alli. El original se guarda en git (me-operacion) porque
rem  el antivirus puede borrarlo; se recupera con:
rem    git checkout scripts/abrir-sin-cors.bat
rem  Seguridad: esa ventana de Edge navega sin CORS. Usala solo para
rem  estas herramientas locales; no navegues a otros sitios en ella.
rem =====================================================================

rem ---------- Configuracion (lo unico que se ajusta) ----------
set "PERFIL=%TEMP%\edge-sin-cors"

set "CARPETA=%~dp0"
set "PAGINA="

rem ---------- 1. index.html ----------
if exist "%CARPETA%index.html" (
    set "PAGINA=%CARPETA%index.html"
    goto :abrir
)

rem ---------- 2/3. Buscar los .html de la carpeta ----------
set /a N=0
for %%F in ("%CARPETA%*.html") do (
    set /a N+=1
    call set "HTML_%%N%%=%%~fF"
)

if %N%==0 (
    echo.
    echo  No hay ningun archivo .html en:
    echo    %CARPETA%
    echo.
    pause
    exit /b 1
)

if %N%==1 (
    set "PAGINA=%HTML_1%"
    goto :abrir
)

:menu
echo.
echo  Hay %N% paginas en esta carpeta. Escoge cual abrir:
echo.
for /l %%I in (1,1,%N%) do call :mostrar %%I
echo.
set "ELEGIDA="
set /p "ELEGIDA=  Numero (1-%N%) y Enter: "
rem Solo se aceptan numeros dentro del rango.
echo %ELEGIDA%| findstr /r "^[0-9][0-9]*$" >nul || goto :invalida
if %ELEGIDA% LSS 1 goto :invalida
if %ELEGIDA% GTR %N% goto :invalida
call set "PAGINA=%%HTML_%ELEGIDA%%%"
goto :abrir

:invalida
echo.
echo  Opcion no valida. Escribe un numero entre 1 y %N%.
goto :menu

:mostrar
call echo    %1. %%HTML_%1:%CARPETA%=%%
exit /b 0

rem ---------- Abrir en Edge sin CORS ----------
:abrir
set "EDGE="
for %%B in ("%ProgramFiles(x86)%" "%ProgramFiles%" "%LOCALAPPDATA%") do (
    if not defined EDGE if exist "%%~B\Microsoft\Edge\Application\msedge.exe" set "EDGE=%%~B\Microsoft\Edge\Application\msedge.exe"
)
if not defined EDGE (
    echo.
    echo  No se encontro Microsoft Edge ^(msedge.exe^) en las rutas estandar.
    echo.
    pause
    exit /b 1
)

rem Perfil temporal limpio en cada apertura: Edge solo acepta
rem --disable-web-security con un --user-data-dir propio.
if exist "%PERFIL%" rmdir /s /q "%PERFIL%" >nul 2>&1

echo.
echo  Abriendo: %PAGINA%
start "" "%EDGE%" --user-data-dir="%PERFIL%" --disable-web-security --allow-file-access-from-files --no-first-run --no-default-browser-check --new-window --start-maximized "%PAGINA%"
exit /b 0
