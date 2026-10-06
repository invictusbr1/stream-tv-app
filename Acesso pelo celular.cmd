@echo off
cd /d "%~dp0"
title Stream TV - acesso pelo celular
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Publicar-Online.ps1"
pause
