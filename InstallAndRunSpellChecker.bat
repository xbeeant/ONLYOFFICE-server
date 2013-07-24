@ECHO OFF

SET SPELLCHECK_SERVICE_NAME=ASC Spellcheck Server
SET INSTAL_SCRIPT_FOLDER=install_script

call %~dp0\%INSTAL_SCRIPT_FOLDER%\InstallNodeJSSpellCheck.bat
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SCRIPT_FOLDER%\InstallAndRunService.bat "%SPELLCHECK_SERVICE_NAME%" "node.exe %~dp0sources\serverSpellCheck.js"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR


:ERROR
:SUCCESS
pause

exit /b 0