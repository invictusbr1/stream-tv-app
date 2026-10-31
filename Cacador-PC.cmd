@echo off
cd /d "%~dp0"
title Cacador do Conecta TV (no PC)
echo.
echo   Cacador do Conecta TV - rodando neste PC
echo   ----------------------------------------
echo   Procura fontes para os titulos que falharam e para as novelas.
echo   Deixe esta janela aberta. Para parar, feche a janela.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Cacador-PC.ps1"
node "%~dp0central\cacador-pc.cjs" %*
echo.
echo   O cacador parou. Veja central\dados-pc\cacador-pc.log
pause
