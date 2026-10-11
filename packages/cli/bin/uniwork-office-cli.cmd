@echo off
rem uniwork-office-cli: the command name on Windows; hands over to genoffice.cmd beside it
call "%~dp0genoffice.cmd" %*
exit /b %errorlevel%
