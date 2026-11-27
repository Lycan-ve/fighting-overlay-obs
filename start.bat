@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js 18 o superior y vuelve a intentarlo.
  pause
  exit /b 1
)
npm start
pause
