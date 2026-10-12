@echo off
rem Double-click to start CineMoy (no terminal or npm needed).
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are missing. Run "npm.cmd install" in this folder first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
