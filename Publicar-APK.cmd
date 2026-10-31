@echo off
cd /d "%~dp0"
title Publicar APK 2.13.128
set LOG=%~dp0publicacao-apk.log
set VERSAO=2.13.128
set SAIDA=%USERPROFILE%\Documents\Codex\apk-%VERSAO%
echo Enviando os APKs %VERSAO% (ja compilados) para o GitHub...
echo === %date% %time% > "%LOG%"
if not exist "%SAIDA%\Conecta-TV-Android-%VERSAO%.apk" (echo FALHOU: APK nao encontrado em %SAIDA% >> "%LOG%" & goto fim)
powershell -NoProfile -ExecutionPolicy Bypass -File android\Publicar-Atualizacao.ps1 -ApkPath "%SAIDA%\Conecta-TV-Android-%VERSAO%.apk" -ApkTvPath "%SAIDA%\Conecta-TV-TV-%VERSAO%.apk" -Notes "Quando a fonte cai ou trava no meio do video, o app continua sozinho do mesmo ponto (primeiro na mesma fonte, para nao perder o 4K) em vez de pedir tente novamente." >> "%LOG%" 2>&1
if errorlevel 1 (echo FALHOU: envio >> "%LOG%" & goto fim)
echo TUDO PUBLICADO >> "%LOG%"
:fim
echo FIM >> "%LOG%"
type "%LOG%"
pause
