@echo off
rem uniwork-office-cli: the command name on Windows; same body as genoffice.cmd (no call: it would alter % and ^ in arguments)
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\UniWork Office.exe" "%~dp0genoffice.cjs" %*
endlocal & exit /b %errorlevel%
