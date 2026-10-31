@echo off
cd /d "%~dp0"
title Incluir BestCine no Conecta TV
echo.
echo   Validando a fonte BestCine (filmes 4K e novelas) antes de incluir...
echo   Na primeira vez pode baixar o medidor de video (alguns minutos).
echo.
node "%~dp0central\cacador-pc.cjs" --incluir central\fichas\bestcine.json
if errorlevel 1 (echo. & echo   NAO INCLUIDA - veja as linhas acima e mande para o chat.) else (echo. & echo   BESTCINE INCLUIDA E PUBLICADA.)
echo.
pause
