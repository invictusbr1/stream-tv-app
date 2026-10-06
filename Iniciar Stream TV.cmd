@echo off
cd /d "%~dp0"
echo Stream TV: abra http://localhost:3000 no navegador.
echo Mantenha esta janela aberta enquanto estiver usando o app.
node server.js
pause
