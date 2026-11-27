@echo off
chcp 65001 >nul
title SonoSticker
cd /d "%~dp0"

if exist "%~dp0runtime\node.exe" if exist "%~dp0node_modules" goto run_portable

call :find_node
if defined NODE_OK goto node_ready

if defined NODE_OLD_MAJOR (
  echo.
  echo [AVISO] Se encontro Node.js v%NODE_OLD_MAJOR%, pero SonoSticker requiere Node.js 20 o superior.
) else (
  echo.
  echo [AVISO] No se encontro Node.js ^(20+^) instalado en tu PC.
  echo Es necesario para ejecutar SonoSticker.
)

:ask_install_node
echo.
choice /c SN /m "Deseas instalar Node.js LTS automaticamente ahora?"
if errorlevel 2 (
  echo.
  echo Instalacion cancelada. Puedes descargarlo manualmente en: https://nodejs.org/
  pause
  exit /b 1
)
echo.

where winget >nul 2>nul
if errorlevel 1 goto manual_node_download

echo Instalando Node.js LTS mediante winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
call :find_node
if defined NODE_OK goto node_ready

:manual_node_download
echo.
echo [AVISO] No se pudo instalar Node.js 20+ automaticamente.
echo Abriendo https://nodejs.org/ para que descargues el instalador LTS...
start "" "https://nodejs.org/"
pause
exit /b 1

:node_ready
if exist "node_modules" goto start_app
echo Instalando dependencias por primera vez ^(solo toma unos segundos^)...
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo la instalacion de dependencias.
  pause
  exit /b 1
)

:start_app
echo Iniciando SonoSticker... ^(se abrira el navegador automaticamente^)
call npm start
if errorlevel 1 (
  echo.
  echo [ERROR] SonoSticker se detuvo con un error.
  pause
)
exit /b 0

:run_portable
echo Iniciando SonoSticker ^(modo portable^)... se abrira el navegador automaticamente.
"%~dp0runtime\node.exe" "%~dp0src\server.js"
if errorlevel 1 (
  echo.
  echo [ERROR] SonoSticker se detuvo con un error.
  pause
)
exit /b 0

:find_node
set "NODE_OK="
set "NODE_OLD_MAJOR="
where node >nul 2>nul
if errorlevel 1 goto find_node_dirs
set "CAND_MAJOR="
for /f "tokens=1 delims=v." %%v in ('node -v 2^>nul') do set "CAND_MAJOR=%%v"
if not defined CAND_MAJOR goto find_node_dirs
if %CAND_MAJOR% GEQ 20 (
  set "NODE_OK=1"
  exit /b 0
)
set "NODE_OLD_MAJOR=%CAND_MAJOR%"

:find_node_dirs
call :try_node_dir "%ProgramFiles%\nodejs"
if defined NODE_OK exit /b 0
call :try_node_dir "%ProgramFiles(x86)%\nodejs"
if defined NODE_OK exit /b 0
call :try_node_dir "%LOCALAPPDATA%\Programs\nodejs"
if defined NODE_OK exit /b 0
if defined NVM_SYMLINK call :try_node_dir "%NVM_SYMLINK%"
exit /b 0

:try_node_dir
if "%~1"=="" exit /b 0
if not exist "%~1\node.exe" exit /b 0
set "CAND_MAJOR="
pushd "%~1" >nul 2>nul
if errorlevel 1 exit /b 0
for /f "tokens=1 delims=v." %%v in ('node.exe -v 2^>nul') do set "CAND_MAJOR=%%v"
popd
if not defined CAND_MAJOR exit /b 0
if %CAND_MAJOR% LSS 20 goto try_node_old
set "PATH=%~1;%PATH%"
set "NODE_OK=1"
exit /b 0

:try_node_old
if not defined NODE_OLD_MAJOR set "NODE_OLD_MAJOR=%CAND_MAJOR%"
exit /b 0
