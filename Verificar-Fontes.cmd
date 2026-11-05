@echo off
cd /d "%~dp0"
title Verificar fontes que voce conhece
echo.
echo   Conferindo os fornecedores de central\fontes-minhas.txt ...
echo   Cada um e testado em filmes e novelas. Os que entregam video dublado
echo   em HD sem pedir login sao ativados e publicados para o app.
echo   Na primeira vez pode baixar o medidor de video (alguns minutos).
echo.
node "%~dp0central\cacador-pc.cjs" --links
echo.
pause
