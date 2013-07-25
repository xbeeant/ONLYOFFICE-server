@ECHO OFF

SET MONGO_DB_SERVICE_NAME=ASC Mongo DB Server
SET CO_AUTHORING_SERVICE_NAME=ASC CoAuthoring Server
SET INSTAL_SERVICE_FOLDER=Common
SET INSTAL_SCRIPT_FOLDER=install
SET SERVICE_FOLDER=CoAuthoring
SET DB_FILE_PATH=CoAuthoring\data\db

IF NOT EXIST %~dp0%DB_FILE_PATH% MKDIR %~dp0%DB_FILE_PATH%
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SERVICE_FOLDER%\%INSTAL_SCRIPT_FOLDER%\InstallAndRunService.bat "%MONGO_DB_SERVICE_NAME%" "%~dp0\%SERVICE_FOLDER%\mongodb\bin\mongod.exe --journal --dbpath "%~dp0%DB_FILE_PATH%"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%SERVICE_FOLDER%\%INSTAL_SCRIPT_FOLDER%\ConfigMongoDB.bat
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%SERVICE_FOLDER%\%INSTAL_SCRIPT_FOLDER%\InstallNodeJSModules.bat
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SERVICE_FOLDER%\%INSTAL_SCRIPT_FOLDER%\InstallAndRunService.bat "%CO_AUTHORING_SERVICE_NAME%" "node.exe %~dp0\%SERVICE_FOLDER%\sources\server.js"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR


:ERROR
:SUCCESS
pause

exit /b 0