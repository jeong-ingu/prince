@echo off
chcp 65001 >nul
REM Auto-collect script (called by Windows Task Scheduler). Non-interactive, appends to scrape.log
cd /d "%~dp0"
echo ==== %DATE% %TIME% ==== >> scrape.log
"C:\Program Files\nodejs\node.exe" "%~dp0scrape.mjs" >> scrape.log 2>&1
