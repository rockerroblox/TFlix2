@echo off
echo Building TFlix...
echo.

echo [1/2] Building mods (userScript)...
cd /d "%~dp0mods"
call npm install
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Mods build failed!
    exit /b %ERRORLEVEL%
)

echo.
echo [2/2] Building service...
cd /d "%~dp0service"
call npm install
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Service build failed!
    exit /b %ERRORLEVEL%
)

echo.
echo ================================
echo Build complete! Output in dist\
echo ================================
echo   dist\userScript.js
echo   dist\service.js
echo.
cd /d "%~dp0"
pause
