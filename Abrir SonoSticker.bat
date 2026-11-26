@echo off
chcp 65001 >nul
title SonoSticker
cd /d "%~dp0"

call :find_node
if defined NODE_FOUND goto node_ready

echo.
echo [INFO] Node.js no esta instalado en tu PC. Se instalara Node.js LTS automaticamente...
echo.

where winget >nul 2>nul
if errorlevel 1 goto install_msi

echo Instalando Node.js LTS mediante winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
call :find_node
if defined NODE_FOUND goto node_ready

:install_msi
echo.
echo Descargando instalador oficial de Node.js LTS...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $lts=$null; foreach($x in (Invoke-RestMethod 'https://nodejs.org/dist/index.json')){ if($x.lts -is [string]){ $lts=$x; break } }; if(-not $lts){ exit 1 }; $arch=if([Environment]::Is64BitOperatingSystem){'x64'}else{'x86'}; $url='https://nodejs.org/dist/'+$lts.version+'/node-'+$lts.version+'-'+$arch+'.msi'; $out=Join-Path $env:TEMP ('node-'+$lts.version+'.msi'); Write-Host ('Descargando '+$url+'...'); (New-Object Net.WebClient).DownloadFile($url,$out); $p=Start-Process msiexec.exe -ArgumentList @('/i',$out,'/passive') -Wait -PassThru; Remove-Item $out -Force -ErrorAction SilentlyContinue; exit $p.ExitCode"
call :find_node
if defined NODE_FOUND goto node_ready

echo.
echo [ERROR] No se pudo instalar Node.js automaticamente.
echo Abriendo https://nodejs.org/ para descarga manual...
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
