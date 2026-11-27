@echo off
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Necesitas Go instalado: descargalo en https://go.dev/dl/ y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
go mod init ggst-token 2>nul
go get github.com/crocchetto/ggst-go@main
go run .
pause
