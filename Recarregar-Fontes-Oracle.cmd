@echo off
cd /d "%~dp0"
title Recarregar fontes na Oracle
echo.
echo   Reiniciando o aplicativo na Oracle para ele ler as fontes novas (BestCine)...
echo   Quem estiver assistindo pode ter uma pausa de alguns segundos.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content (Join-Path $env:USERPROFILE '.conecta-tv-vm.json') -Raw | ConvertFrom-Json; ssh -i $c.chave -o StrictHostKeyChecking=accept-new ('ubuntu@'+$c.ip) 'cd /opt/conecta-tv && sudo docker compose -p servidor --env-file deploy/servidor/.env -f deploy/servidor/docker-compose.yml -f deploy/servidor/docker-compose.oracle.yml restart app && echo REINICIADO'"
echo.
echo   Pronto. Em cerca de 1 minuto a Oracle ja usa o BestCine.
pause
