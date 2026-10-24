# Instala a voz clonada LOCAL (opcional). Não precisa disso se usar voz por API ou a voz do Windows.
#   .\setup_voice.ps1 xtts         # Coqui XTTS v2 (uso não comercial)
#   .\setup_voice.ps1 chatterbox   # Chatterbox (MIT)
# Precisa do Python 3.11 (python.org). Cria server\voice\venv-<motor> com PyTorch para CPU.
# Tudo que acontece fica em install.log (mande esse arquivo se pedir ajuda).
param([Parameter(Mandatory)][ValidateSet("xtts", "chatterbox")][string]$Engine)
# "Continue" de propósito: no Windows PowerShell 5.1 o aviso que o pip escreve na tela derrubaria o script
# à toa. O resultado de cada passo é conferido pelo código de saída (Passo) e pela importação final.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
try { Start-Transcript -Path (Join-Path $PSScriptRoot "install.log") -Append | Out-Null } catch { }

function Passo($texto, [scriptblock]$comando) {
    Write-Host ""
    Write-Host ">> $texto" -ForegroundColor Cyan
    & $comando
    if ($LASTEXITCODE -ne 0) { throw "Falhou: $texto (código $LASTEXITCODE). Veja as mensagens acima." }
}

try {
    $py = if (Get-Command py -ErrorAction SilentlyContinue) { "py -3.11" } else { "python" }
    $ver = (cmd /c "$py --version 2>&1" | Out-String).Trim()
    if ($ver -notmatch "Python 3\.11") {
        throw "Precisa do Python 3.11 (achei: '$ver'). O 3.12 ou mais novo NÃO funciona com a voz local. Instale em https://www.python.org/downloads/release/python-3119/ e marque 'Add python.exe to PATH'."
    }
    Write-Host "Python OK: $ver" -ForegroundColor Green

    $venv = "venv-$Engine"
    $python = Join-Path $venv "Scripts\python.exe"
    if (-not (Test-Path $python)) { Passo "Criando o ambiente $venv" { Invoke-Expression "$py -m venv $venv" } }
    if (-not (Test-Path $python)) { throw "O ambiente $venv não foi criado." }

    Passo "Atualizando o pip" { & $python -m pip install --upgrade pip }
    # o servidor de voz (voice_server.py) e o script de referência usam estes
    Passo "Instalando numpy, soundfile, soxr e scipy" { & $python -m pip install numpy soundfile soxr scipy }

    if ($Engine -eq "xtts") {
        Passo "Instalando o PyTorch para CPU (alguns minutos)" { & $python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu }
        Passo "Instalando o XTTS (coqui-tts)" { & $python -m pip install coqui-tts }
        $modulo = "TTS"
    } else {
        Passo "Instalando o Chatterbox (alguns minutos)" { & $python -m pip install chatterbox-tts }
        $modulo = "chatterbox"
    }

    # só diz que deu certo se o pacote realmente está dentro do ambiente
    & $python -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$modulo') else 1)"
    if ($LASTEXITCODE -ne 0) { throw "A instalação terminou, mas o pacote '$modulo' não ficou no ambiente." }

    Write-Host ""
    Write-Host "Pronto! O $Engine está instalado." -ForegroundColor Green
    Write-Host "No painel (aba Voz) escolha '$Engine' e salve. O primeiro uso baixa o modelo (alguns GB)."
} catch {
    Write-Host ""
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Nada foi concluído. O texto completo está em server\voice\install.log" -ForegroundColor Red
    Write-Host "Para tentar de novo do zero, apague a pasta server\voice\venv-$Engine e rode este script outra vez." -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}
try { Stop-Transcript | Out-Null } catch { }
