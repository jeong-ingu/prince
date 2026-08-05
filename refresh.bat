@echo off
cd /d "%~dp0"
echo === Wangsimni Xi listing tracker refresh ===
node scrape.mjs
echo.
echo Done. Open index.html in your browser.
pause
