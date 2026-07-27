@echo off
title MAMUTS - Gestion de Flota
cd /d "%~dp0"
echo Iniciando MAMUTS Gestion de Flota...
start "" http://localhost:3000
node server.js
pause
