@echo off
setlocal
cd /d "%~dp0"

rem The 3D viewer uses ES modules and fetch(), which browsers block on file:// URLs.
rem Serve this folder over HTTP instead of double-clicking index.html.

where python >nul 2>nul
if %errorlevel%==0 goto :use_python

where py >nul 2>nul
if %errorlevel%==0 goto :use_py

echo Python was not found. Install Python 3, or open this folder with the
echo VS Code "Live Server" extension instead.
pause
exit /b 1

:use_python
set "PYTHON=python"
goto :run

:use_py
set "PYTHON=py -3"
goto :run

:run
echo Starting a local server at http://127.0.0.1:8000/
echo Close the "Cross3DReg local server" window to stop it.
start "Cross3DReg local server" cmd /k %PYTHON% serve.py 8000
timeout /t 2 >nul
start "" "http://127.0.0.1:8000/"
