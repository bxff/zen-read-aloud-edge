@echo off
cd /d "%~dp0"
py -3 Install-Windows.py
if errorlevel 1 python Install-Windows.py
pause
