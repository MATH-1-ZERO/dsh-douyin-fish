@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-Windows.ps1" %*
set "FISH_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %FISH_EXIT%
