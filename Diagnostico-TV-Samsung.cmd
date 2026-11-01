@echo off
cd /d "%~dp0"
title Diagnostico TV Samsung
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0samsung\Diagnostico-Rede-Samsung.ps1"
echo.
pause
