@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM Voxyl Android Debug Build + Install
REM Run this file from anywhere. It uses the project path below.
REM ============================================================

set "PROJECT_DIR=C:\GitHub\Voxyl-APP"
set "ANDROID_DIR=%PROJECT_DIR%\android"
set "APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\debug\app-debug.apk"
set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo.
echo ============================================================
echo Voxyl - Build and install debug APK
echo Project: %PROJECT_DIR%
echo ============================================================
echo.

IF NOT EXIST "%PROJECT_DIR%" (
  echo [ERROR] Project folder not found: %PROJECT_DIR%
  goto :fail
)

IF NOT EXIST "%ADB%" (
  echo [ERROR] ADB not found: %ADB%
  echo Install Android SDK Platform Tools or check Android Studio SDK path.
  goto :fail
)

IF NOT EXIST "%JAVA_HOME%\bin\java.exe" (
  echo [ERROR] Java not found: %JAVA_HOME%\bin\java.exe
  echo Check Android Studio JBR path.
  goto :fail
)

cd /d "%PROJECT_DIR%" || goto :fail

echo.
echo [1/9] Current git branch and status
git branch --show-current
git status --short

echo.
echo [2/9] Pull latest changes from current branch
git pull
IF ERRORLEVEL 1 goto :fail

echo.
echo [3/9] Install/update npm dependencies
call npm install
IF ERRORLEVEL 1 goto :fail

echo.
echo [4/9] Build web app
call npm run build
IF ERRORLEVEL 1 goto :fail

echo.
echo [5/9] Sync Capacitor Android
call npx cap sync android
IF ERRORLEVEL 1 goto :fail

echo.
echo [6/9] Build Android debug APK
cd /d "%ANDROID_DIR%" || goto :fail
call gradlew.bat clean assembleDebug
IF ERRORLEVEL 1 goto :fail

IF NOT EXIST "%APK_PATH%" (
  echo [ERROR] APK not found: %APK_PATH%
  goto :fail
)

echo.
echo [7/9] Checking connected Android devices
"%ADB%" devices

echo.
echo If no device is listed as "device", connect the phone, enable USB debugging,
echo authorize this computer on the phone, then press CTRL+C and run again.
echo.
pause

echo.
echo [8/9] Clean install APK on phone
"%ADB%" uninstall com.renbrant.voxyl
echo Note: uninstall may fail if app was not installed. Continuing...
"%ADB%" install "%APK_PATH%"
IF ERRORLEVEL 1 goto :fail

echo.
echo [9/9] Installed package info
"%ADB%" shell dumpsys package com.renbrant.voxyl | findstr /i "versionName versionCode firstInstallTime lastUpdateTime"

echo.
echo ============================================================
echo SUCCESS - Voxyl APK installed on phone.
echo ============================================================
echo.
echo To watch auth logs, run:
echo "%ADB%" logcat -v time ^| Select-String -SimpleMatch "[AUTH]"
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo FAILED - Check the error above.
echo ============================================================
echo.
pause
exit /b 1
