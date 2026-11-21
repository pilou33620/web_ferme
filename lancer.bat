@echo off
rem La Ferme du Val Vert (Windows) : double-cliquez sur ce fichier.
rem Le jeu sort avec le code 75 quand il vient de se mettre a jour (git pull) : on reprend l executable, puis on relance.
chcp 65001 >nul
cd /d "%~dp0"
set FERME_RELANCEUR=1
:boucle
call binaires.cmd || goto erreur
bin\ferme.exe %*
if %errorlevel%==75 goto boucle
if errorlevel 1 goto erreur
exit /b 0
:erreur
pause
