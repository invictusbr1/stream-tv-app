@echo off
cd /d "%~dp0"
title Conecta TV
echo Conecta TV
echo Abra o navegador em http://localhost:3000
echo Mantenha esta janela aberta enquanto estiver usando o aplicativo.
echo.
node server.js
pause
