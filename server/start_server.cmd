@echo off
rem Inicia o servidor da live (usado pelo Live3D.exe). Log em runs\server.log.
cd /d "%~dp0"
if not exist runs mkdir runs
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez... >> runs\server.log
  call npm install --omit=dev >> runs\server.log 2>&1
)
node src\index.js >> runs\server.log 2>&1
