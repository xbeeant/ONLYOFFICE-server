ECHO OFF

SET RUN_FOLDER=%CD%

CD /D %~dp0..\ || exit /b 1

ECHO.
ECHO ----------------------------------------
ECHO Install node.js module spellCheck (nodehun) 
ECHO ----------------------------------------

call npm install express --production || exit /b 1
call npm install sockjs --production || exit /b 1

call npm install -g node-gyp || exit /b 1

XCOPY /S nodehun node_modules\nodehun\ /Y 

cd /D node_modules\nodehun\src || exit /b 1
call node-gyp configure || exit /b 1
call node-gyp build	|| exit /b 1

cd /D ..\..\..\..\Common || exit /b 1
call npm install log4js --production --no-optional || exit /b 1

CD /D %RUN_FOLDER% || exit /b 1

exit /b 0
