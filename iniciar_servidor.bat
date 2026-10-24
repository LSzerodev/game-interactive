@echo off
rem Live 3D - inicia SO o servidor, numa janela que mostra o que esta acontecendo.
rem Depois abra o Live3D.exe: ele ve que o servidor ja esta no ar e nao sobe outro.
rem Para parar: feche esta janela ou aperte CTRL+C.
setlocal
title Live 3D - Servidor
cd /d "%~dp0"
if not defined PORT set PORT=9393
set NOBROWSER=0
if /i "%~1"=="/nobrowser" set NOBROWSER=1

echo.
echo ==========================================================
echo   LIVE 3D - servidor
echo ==========================================================
echo.

if not exist "server\src\index.js" goto :sem_server
where node >nul 2>&1
if errorlevel 1 goto :sem_node
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODEV=%%v
set NODEV=%NODEV:v=%
for /f "delims=." %%a in ("%NODEV%") do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 20 goto :node_velho

netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 goto :ja_rodando

cd server
if exist "node_modules" goto :iniciar
echo Instalando as dependencias, so na primeira vez. Leva cerca de 1 minuto e precisa de internet...
echo.
call npm install --omit=dev
if errorlevel 1 goto :falha_npm
echo.

:iniciar
echo Servidor iniciando. Painel: http://127.0.0.1:%PORT%
echo.
echo   1. O painel abre sozinho no navegador.
echo   2. Abra o Live3D.exe depois. Ele conecta neste servidor.
echo   3. Para parar tudo, feche esta janela.
echo.
if "%NOBROWSER%"=="0" start "" /min "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process 'http://127.0.0.1:%PORT%'"
set tentativas=0

:rodar
node src\index.js
set CODIGO=%errorlevel%
set /a tentativas+=1
echo.
echo [%time%] O servidor parou com codigo %CODIGO%. Reiniciando, tentativa %tentativas% de 20...
if %tentativas% geq 20 goto :desistiu
ping -n 4 127.0.0.1 >nul
goto :rodar

:desistiu
echo.
echo O servidor caiu muitas vezes seguidas. Rode verificar.bat para ver o que falta,
echo e mande o texto desta janela na comunidade para pedir ajuda.
goto :fim

:sem_server
echo [ FALTA ] Pasta server nao encontrada ao lado deste arquivo.
echo Extraia o ZIP inteiro, sem tirar arquivos de lugar, e rode de novo.
goto :fim

:sem_node
echo [ FALTA ] Node.js nao esta instalado.
echo Baixe a versao LTS em https://nodejs.org, instale, FECHE esta janela e rode de novo.
goto :fim

:node_velho
echo [ FALTA ] Node.js %NODEV% e muito antigo. Precisa da versao 20 ou mais nova.
echo Baixe a LTS em https://nodejs.org e instale por cima.
goto :fim

:falha_npm
echo.
echo [ FALTA ] Nao consegui baixar as dependencias. Confira a internet e o antivirus ou firewall.
goto :fim

:ja_rodando
echo O servidor ja esta rodando na porta %PORT%. Nao precisa iniciar de novo.
echo Painel: http://127.0.0.1:%PORT%
if "%NOBROWSER%"=="0" start "" "http://127.0.0.1:%PORT%"

:fim
echo.
if "%NOBROWSER%"=="1" exit /b 1
pause
