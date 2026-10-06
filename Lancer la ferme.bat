@echo off
rem Lanceur Windows de « La Ferme du Val Vert » : double-cliquez sur ce fichier.
rem Au démarrage, le jeu cherche une mise à jour sur GitHub, l'installe et se relance tout seul.
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py %*
) else (
  py server.py %*
)
if errorlevel 1 pause
