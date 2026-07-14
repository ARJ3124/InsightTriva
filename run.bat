@echo off
title Insight Trivia - Server Launcher
echo ===================================================
echo   Insight Trivia - Real-Time Multiplayer Platform
echo ===================================================
echo.

:: 1. Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not detected on this system.
    echo.
    echo To run this multiplayer quiz platform, please install Node.js:
    echo 1. Download and run the installer from: https://nodejs.org/
    echo 2. Accept defaults and complete installation.
    echo 3. Re-run this launcher script.
    echo.
    pause
    exit /b 1
)

:: 2. Install dependencies if node_modules folder is missing
if not exist node_modules (
    echo [SETUP] First-time run detected. Installing dependencies (Express & Socket.io)...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Dependency installation failed! Check your internet connection.
        echo.
        pause
        exit /b 1
      )
) else (
    echo [INFO] Dependencies verified successfully.
)

echo.
echo ===================================================
echo   Server is starting up...
echo   Open your browser at: http://localhost:8080
echo ===================================================
echo.

:: 3. Start node server
call npm start
pause
