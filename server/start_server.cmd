@echo off
rem Inicia o servidor da live (usado pelo Live3D.exe). Log em runs\server.log.
rem Se o servidor cair por qualquer motivo, sobe de novo sozinho.
cd /d "%~dp0"
if not exist runs mkdir runs
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez... >> runs\server.log
  call npm install --omit=dev >> runs\server.log 2>&1
)
set tentativas=0
:rodar
node src\index.js >> runs\server.log 2>&1
set /a tentativas+=1
echo [%time%] servidor encerrou com codigo %errorlevel%, reiniciando tentativa %tentativas% de 20... >> runs\server.log
if %tentativas% geq 20 exit /b 1
ping -n 4 127.0.0.1 >nul
goto rodar
