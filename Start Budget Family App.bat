@echo off
title Budget Family App
start "Budget Family App Server" /D "%~dp0" cmd /k npm run dev
timeout /t 4 /nobreak >nul
start "" http://localhost:3000
