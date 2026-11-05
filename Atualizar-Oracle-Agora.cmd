@echo off
cd /d "%~dp0"
title Atualizar a Oracle agora
echo.
echo   Enviando a versao atual desta pasta para a Oracle (site e servidor).
echo   Leva de 5 a 20 minutos. Nao feche esta janela.
echo.
schtasks /End /TN "Connecta TV - Atualizacao Oracle" >nul 2>&1
node deploy\servidor\publicar-automatico.cjs --once
if errorlevel 1 (echo. & echo   NAO CONCLUIU - copie as linhas acima para o chat.) else (echo. & echo   ORACLE ATUALIZADA.)
echo.
echo   Religando o monitor automatico...
schtasks /Run /TN "Connecta TV - Atualizacao Oracle" >nul 2>&1
node deploy\servidor\publicar-automatico.cjs --status
pause
