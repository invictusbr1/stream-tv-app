@echo off
cd /d "%~dp0"
title Conecta TV - acesso pelo celular
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Publicar-Online.ps1"
pause
