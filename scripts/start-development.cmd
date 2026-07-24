@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0.."
set "DOCKER_CLI=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"

pushd "%PROJECT_ROOT%" >nul || exit /b 1

call :start-development
set "EXIT_CODE=%ERRORLEVEL%"

popd >nul
goto :end

:start-development
echo [%DATE% %TIME%] Starting Classroom Hub development environment.

if not exist "%DOCKER_CLI%" (
  echo Docker CLI not found at "%DOCKER_CLI%".
  exit /b 1
)

where pnpm.cmd >nul 2>&1
if errorlevel 1 (
  echo pnpm.cmd is not available on PATH.
  exit /b 1
)

"%DOCKER_CLI%" desktop start --timeout 120
if errorlevel 1 exit /b %ERRORLEVEL%

call :ensure-cloudflared
if errorlevel 1 exit /b %ERRORLEVEL%

call pnpm.cmd infra:up
if errorlevel 1 exit /b %ERRORLEVEL%

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { exit 0 }; exit 1"
if not errorlevel 1 (
  powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8001 -ErrorAction SilentlyContinue) { exit 0 }; exit 1"
  if not errorlevel 1 (
    echo Classroom Hub development services are already running.
    call pnpm.cmd dev:doctor
    exit /b %ERRORLEVEL%
  )

  echo Port 8000 is already in use while Classroom Hub API is not running on port 8001.
  exit /b 1
)

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8001 -ErrorAction SilentlyContinue) { exit 0 }; exit 1"
if not errorlevel 1 (
  echo Port 8001 is already in use while Classroom Hub dashboard is not running on port 8000.
  exit /b 1
)

echo Starting Vite, API, jobs worker, and shared package watchers. Press Ctrl+C to stop them.
call pnpm.cmd dev:core
exit /b %ERRORLEVEL%

:ensure-cloudflared
sc.exe query cloudflared | findstr /r /c:"STATE.*RUNNING" >nul
if not errorlevel 1 exit /b 0

echo Starting Cloudflared service.
sc.exe start cloudflared >nul
timeout /t 2 /nobreak >nul
sc.exe query cloudflared | findstr /r /c:"STATE.*RUNNING" >nul
if not errorlevel 1 exit /b 0

echo Cloudflared is not running. Run this script from an elevated shell or start the Cloudflared service.
exit /b 1

:end
exit /b %EXIT_CODE%
