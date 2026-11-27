@echo off
chcp 65001 >nul
title SonoSticker
cd /d "%~dp0"

if exist "%~dp0runtime\node.exe" if exist "%~dp0node_modules" goto run_portable

call :find_node
if defined NODE_FOUND goto check_node_version

echo.
echo [AVISO] No se encontro Node.js ^(20+^) instalado en tu PC.
echo Es necesario para ejecutar SonoSticker.
goto ask_install_node

:check_node_version
set "NODE_MAJOR="
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto ask_install_node
if %NODE_MAJOR% GEQ 20 goto node_ready

echo.
echo [AVISO] Se encontro Node.js v%NODE_MAJOR%, pero SonoSticker requiere Node.js 20 o superior.

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
if defined NODE_FOUND goto verify_after_install

:manual_node_download
echo.
echo [AVISO] No se pudo instalar Node.js automaticamente ^(winget no disponible o cancelado^).
echo Abriendo https://nodejs.org/ para que descargues el instalador LTS...
start "" "https://nodejs.org/"
pause
exit /b 1

:verify_after_install
set "NODE_MAJOR="
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
if defined NODE_MAJOR if %NODE_MAJOR% GEQ 20 goto node_ready
echo.
echo [ERROR] Node.js actualizado no se detecto correctamente. Reinicia la consola o descargalo en: https://nodejs.org/
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
set "NODE_FOUND="
where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_FOUND=1"
  exit /b 0
)
call :try_node_dir "%ProgramFiles%\nodejs"
if defined NODE_FOUND exit /b 0
call :try_node_dir "%ProgramFiles(x86)%\nodejs"
if defined NODE_FOUND exit /b 0
call :try_node_dir "%LOCALAPPDATA%\Programs\nodejs"
if defined NODE_FOUND exit /b 0
if defined NVM_SYMLINK call :try_node_dir "%NVM_SYMLINK%"
exit /b 0

:try_node_dir
if "%~1"=="" exit /b 0
if not exist "%~1\node.exe" exit /b 0
set "PATH=%~1;%PATH%"
set "NODE_FOUND=1"
exit /b 0
