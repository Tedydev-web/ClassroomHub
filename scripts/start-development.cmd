@echo off
setlocal

set "LOG_DIRECTORY=%ProgramData%\ClassroomIO\logs"
set "LOG_FILE=%LOG_DIRECTORY%\development.log"
set "DOCKER_CLI=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"

if not exist "%LOG_DIRECTORY%" mkdir "%LOG_DIRECTORY%"

call :start-development >> "%LOG_FILE%" 2>&1
exit /b %ERRORLEVEL%

:start-development
echo [%DATE% %TIME%] Starting ClassroomIO development environment.

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

call pnpm.cmd infra:up
if errorlevel 1 exit /b %ERRORLEVEL%

call pnpm.cmd dev:core
exit /b %ERRORLEVEL%
