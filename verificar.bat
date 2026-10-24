@echo off
rem Live 3D - verifica se este computador tem tudo para rodar o jogo e o servidor.
rem Uso: de dois cliques. Nao instala nem muda nada, so confere e avisa o que falta.
setlocal
title Live 3D - Verificacao do computador
cd /d "%~dp0"
set FALTA=0
set AVISO=0
set AUTO=0
if /i "%~1"=="/auto" set AUTO=1

echo.
echo ==========================================================
echo   LIVE 3D - verificando o seu computador
echo ==========================================================
echo.
echo Pasta: %CD%
echo.

echo --- Windows e arquivos do jogo ---
if /i not "%OS%"=="Windows_NT" call :falta "Isto precisa do Windows 10 ou 11."
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 call :falta "Windows de 32 bits nao e suportado. O jogo precisa de Windows 64 bits."
if /i "%OS%"=="Windows_NT" call :ok "Windows 64 bits"

if exist "Live3D.exe" (call :ok "Live3D.exe encontrado") else call :falta "Live3D.exe nao esta nesta pasta. Extraia o ZIP inteiro e rode este arquivo de dentro da pasta extraida."

if exist "server\src\index.js" (call :ok "Pasta server encontrada") else call :falta "Pasta server nao encontrada ao lado do Live3D.exe. Extraia o ZIP inteiro, sem tirar arquivos de lugar."

echo %CD% | findstr /i /c:"\AppData\Local\Temp" >nul && call :falta "Voce esta rodando de dentro do ZIP. Clique com o botao direito no ZIP, Extrair tudo, e rode de la."
echo %CD% | findstr /i /c:"\Program Files" >nul && call :aviso "Pasta dentro de Program Files: o Windows pode bloquear a gravacao. Prefira uma pasta como C:\Live3D."

if not exist "server\runs" mkdir "server\runs" >nul 2>&1
echo teste> "server\runs\.teste" 2>nul
if exist "server\runs\.teste" (del "server\runs\.teste" >nul 2>&1 & call :ok "Pasta com permissao de gravacao") else call :falta "Nao consigo gravar em server\runs. Mova a pasta para um lugar comum, como C:\Live3D ou sua Area de Trabalho."

echo.
echo --- Node.js, necessario para o servidor ---
where node >nul 2>&1
if errorlevel 1 goto :sem_node
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODEV=%%v
set NODEV=%NODEV:v=%
for /f "delims=." %%a in ("%NODEV%") do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 20 goto :node_velho
call :ok "Node.js %NODEV%"
goto :npm

:sem_node
call :falta "Node.js NAO esta instalado. Baixe a versao LTS em https://nodejs.org, instale com tudo marcado como padrao, FECHE esta janela e rode este arquivo de novo."
goto :modulos

:node_velho
call :falta "Node.js %NODEV% e muito antigo. Precisa da versao 20 ou mais nova. Baixe a LTS em https://nodejs.org e instale por cima."
goto :npm

:npm
where npm >nul 2>&1
if errorlevel 1 (call :falta "npm nao encontrado. Reinstale o Node.js em https://nodejs.org") else call :ok "npm encontrado"

:modulos
echo.
echo --- Dependencias do servidor ---
if exist "server\node_modules" goto :modulos_ok
call :aviso "As dependencias ainda nao foram instaladas. Na primeira vez que abrir o jogo elas sao baixadas sozinhas, o que leva cerca de 1 minuto e precisa de internet."
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "try { Invoke-WebRequest https://registry.npmjs.org/ -UseBasicParsing -Method Head -TimeoutSec 6 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (call :falta "Sem acesso a internet ou ao registry.npmjs.org. Conecte-se, ou libere o Node.js no antivirus ou firewall, para baixar as dependencias.") else call :ok "Internet funcionando para baixar as dependencias"
goto :porta
:modulos_ok
call :ok "Dependencias ja instaladas"

:porta
echo.
echo --- Porta do painel ---
netstat -ano | findstr /r /c:"127.0.0.1:9393 .*LISTENING" >nul 2>&1
if errorlevel 1 (call :ok "Porta 9393 livre") else call :aviso "A porta 9393 ja esta em uso. Provavelmente o Live 3D ja esta aberto. Se nao estiver, feche o programa que usa a porta ou mude PORT em server\.env."

echo.
echo --- Quem escreve as respostas, a IA ---
set OLLAMA=0
where ollama >nul 2>&1 && set OLLAMA=1
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set OLLAMA=1
if "%OLLAMA%"=="0" goto :sem_ollama
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (call :aviso "Ollama instalado mas fechado. Abra o aplicativo Ollama pelo menu Iniciar.") else call :ok "Ollama instalado e rodando"
echo        Modelos instalados:
ollama list 2>nul
goto :voz
:sem_ollama
call :aviso "Ollama nao encontrado. Sem problema se for usar OpenAI ou Gemini com chave, escolha no painel, aba IA. Para IA gratis no PC, instale em https://ollama.com/download"

:voz
echo.
echo --- Voz local opcional, so para voz clonada XTTS ou Chatterbox ---
set PY=0
py -3.11 -c "pass" >nul 2>&1
if not errorlevel 1 set PY=1
if "%PY%"=="0" python -c "import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)" >nul 2>&1
if "%PY%"=="0" if not errorlevel 1 set PY=1
if "%PY%"=="1" (call :ok "Python 3.11 encontrado") else call :aviso "Python 3.11 nao encontrado. So precisa se for usar voz clonada local. A voz do Windows e as vozes por API funcionam sem ele."

echo.
echo ==========================================================
if %FALTA% GTR 0 goto :resumo_falta
if %AVISO% GTR 0 goto :resumo_aviso
echo   TUDO CERTO. Pode abrir o Live3D.exe.
goto :fim
:resumo_aviso
echo   PODE RODAR. Ha %AVISO% aviso, leia acima, nada impede de abrir.
goto :fim
:resumo_falta
echo   NAO VAI FUNCIONAR AINDA. Falta resolver %FALTA% item, marcado com FALTA acima.
echo   Resolva e rode este arquivo de novo.
:fim
echo ==========================================================
echo.
echo Se o Windows bloquear o Live3D.exe com a tela azul "protegeu o seu computador",
echo clique em "Mais informacoes" e depois em "Executar assim mesmo".
echo Duvidas e mais jogos: https://t.me/+dodaVsUWVoQ0Yjhh
echo.
if "%AUTO%"=="1" exit /b %FALTA%
if %FALTA% GTR 0 goto :pausa
choice /c SN /n /m "Abrir o Live 3D agora? [S/N] "
if errorlevel 2 goto :pausa
start "" "Live3D.exe"
:pausa
pause
exit /b %FALTA%

:ok
echo   [ OK    ] %~1
exit /b 0
:aviso
set /a AVISO+=1
echo   [ AVISO ] %~1
exit /b 0
:falta
set /a FALTA+=1
echo   [ FALTA ] %~1
exit /b 0
