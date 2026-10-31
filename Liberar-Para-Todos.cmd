@echo off
cd /d "%~dp0"
title Liberar versao para a familia
echo.
echo   Liberando para todos a versao que voce testou no seu celular...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Liberar-Para-Todos.ps1"
echo.
pause
