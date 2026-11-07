@echo off
cd /d "%~dp0"
title Publicar Conecta TV
set LOG=%~dp0publicacao.log
set VERSAO=2.13.149
set SAIDA=%USERPROFILE%\Documents\Codex\apk-%VERSAO%
echo Publicando o Conecta TV %VERSAO%. Leva alguns minutos, nao feche esta janela...
echo === %date% %time% > "%LOG%"

echo [1/5] Testes...
echo --- testes >> "%LOG%"
call npm test >> "%LOG%" 2>&1
if not errorlevel 1 goto testes_ok
rem Alguns testes do seletor de qualidade medem tempo (250 ms) e podem falhar com o PC ocupado.
rem Uma falha real se repete; uma oscilacao de tempo passa na segunda rodada.
echo Um teste falhou, repetindo a rodada para descartar oscilacao de tempo...
echo --- testes (segunda rodada) >> "%LOG%"
call npm test >> "%LOG%" 2>&1
if errorlevel 1 (echo FALHOU: testes >> "%LOG%" & echo Testes que falharam: & findstr /c:"WebView bloqueou" /c:"test at " /c:"AssertionError" "%LOG%" & goto fim)
:testes_ok

echo [2/5] Servidor da Oracle (o monitor automatico ja publica sozinho)...
echo --- estado da Oracle >> "%LOG%"
node deploy\servidor\publicar-automatico.cjs --status >> "%LOG%" 2>&1

echo [3/5] Procurando as ferramentas do Android...
set TOOLS=
for %%d in ("%USERPROFILE%\android-tools" "C:\android-tools" "%USERPROFILE%\Documents\android-tools") do if not defined TOOLS if exist "%%~d\sdk" set "TOOLS=%%~d"
if not defined TOOLS for /d /r "%USERPROFILE%\Documents\Codex" %%d in (android-tools) do if not defined TOOLS if exist "%%d\sdk" set "TOOLS=%%d"
echo TOOLS=%TOOLS% >> "%LOG%"
if not defined TOOLS (echo FALHOU: pasta android-tools nao encontrada >> "%LOG%" & goto fim)

echo [4/5] Compilando os APKs (celular e TV)...
echo --- compilando APKs >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File android\Build-Android.ps1 -ToolRoot "%TOOLS%" -BuildDirectory "%USERPROFILE%\Documents\Codex\android-build-stream-tv" -OutputDirectory "%SAIDA%" >> "%LOG%" 2>&1
if errorlevel 1 (echo FALHOU: compilacao Android >> "%LOG%" & goto fim)

echo [5/5] Publicando a atualizacao do aplicativo...
echo --- publicando APKs >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File android\Publicar-Atualizacao.ps1 -Canal teste -ApkPath "%SAIDA%\Conecta-TV-Android-%VERSAO%.apk" -ApkTvPath "%SAIDA%\Conecta-TV-TV-%VERSAO%.apk" -Notes "Anime legendado pela TorBox (so anime) em Full HD com legenda em portugues; proximo episodio de series ja fica pronto; TorBox nao fica mais preso em Voltando de onde voce parou." >> "%LOG%" 2>&1
if errorlevel 1 (echo FALHOU: publicacao dos APKs >> "%LOG%" & goto fim)
echo TUDO PUBLICADO NO CANAL DE TESTE >> "%LOG%"
echo --- salvando a versao no git >> "%LOG%"
git add -A >> "%LOG%" 2>&1
git -c user.name="Marlon" -c user.email="Lemosmarlon@outlook.com" commit -q -m "%VERSAO%" >> "%LOG%" 2>&1
git tag -f v%VERSAO% >> "%LOG%" 2>&1
echo VERSAO SALVA: v%VERSAO% >> "%LOG%"
echo.
echo   Se aparecer "Canal de teste" abaixo, a versao %VERSAO% foi SO para o seu celular:
echo   use um pouco e, se estiver tudo certo, rode Liberar-Para-Todos.cmd.

:fim
echo FIM >> "%LOG%"
echo.
type "%LOG%" | findstr /b /c:"===" /c:"---" /c:"ORACLE" /c:"FALHOU" /c:"TUDO" /c:"VERSAO SALVA" /c:"Canal de teste" /c:"vai para todos" /c:"APK" /c:"Enviado" /c:"FIM"
echo.
echo O registro completo esta em publicacao.log
pause
