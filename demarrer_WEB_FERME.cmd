@echo off
rem Lancement de La Ferme du Val Vert, a double-cliquer : garde la fenetre ouverte en cas d'erreur.
chcp 65001 >nul
cd /d "%~dp0"
rem Un seul fichier a cliquer : les lanceurs de l'autre systeme (.sh) sont masques.
attrib +h "%~dp0*.sh" >nul 2>nul
rem L'outil sort avec le code 75 quand il vient de se mettre a jour (git pull, ou archive de
rem production) : on reprend l'executable de la nouvelle version, puis on le relance.
set FERME_RELANCEUR=1
:encore
call scripts\binaires.cmd
if errorlevel 1 goto echec
bin\ferme.exe %*
if %errorlevel%==75 goto encore
if not errorlevel 1 exit /b 0
:echec
echo.
echo [X] Le demarrage a echoue. La raison est ecrite au-dessus.
echo.
pause
exit /b 1
