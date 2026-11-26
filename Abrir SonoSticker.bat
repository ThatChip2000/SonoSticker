@echo off
chcp 65001 >nul
title SonoSticker
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] No se encontro Node.js instalado en tu PC.
  echo Descarga e instala Node.js 20+ desde: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias por primera vez ^(solo toma unos segundos^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Fallo la instalacion de dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando SonoSticker... ^(se abrira el navegador automaticamente^)
call npm start
if errorlevel 1 (
  echo.
  echo [ERROR] SonoSticker se detuvo con un error.
  pause
)
