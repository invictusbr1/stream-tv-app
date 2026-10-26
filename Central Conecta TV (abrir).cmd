@echo off
chcp 65001 >nul
title Central do Conecta TV
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Abrir-Central.ps1"
