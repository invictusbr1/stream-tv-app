@echo off
cd /d "%~dp0"
title Publicar Conecta TV na Oracle
set LOG=%~dp0publicacao-oracle.log
echo Publicando o Conecta TV na Oracle. Isso leva alguns minutos, nao feche esta janela...
echo === %date% %time% > "%LOG%"
echo --- parando o monitor antigo >> "%LOG%"
schtasks /End /TN "Connecta TV - Atualizacao Oracle" >> "%LOG%" 2>&1
timeout /t 5 /nobreak >nul
echo --- estado antes >> "%LOG%"
node deploy\servidor\publicar-automatico.cjs --status >> "%LOG%" 2>&1
echo --- publicando >> "%LOG%"
node deploy\servidor\publicar-automatico.cjs --once >> "%LOG%" 2>&1
echo CODIGO=%errorlevel% >> "%LOG%"
echo --- estado depois >> "%LOG%"
node deploy\servidor\publicar-automatico.cjs --status >> "%LOG%" 2>&1
echo --- religando o monitor >> "%LOG%"
schtasks /Run /TN "Connecta TV - Atualizacao Oracle" >> "%LOG%" 2>&1
echo FIM >> "%LOG%"
type "%LOG%"
pause
