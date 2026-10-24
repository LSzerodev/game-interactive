# Instala a voz clonada LOCAL (opcional). Não precisa disso se usar voz por API ou a voz do Windows.
#   .\setup_voice.ps1 xtts         # Coqui XTTS v2 (uso não comercial)
#   .\setup_voice.ps1 chatterbox   # Chatterbox (MIT)
# Precisa do Python 3.11 (python.org). Cria server\voice\venv-<motor> com PyTorch para CPU.
# Instala as versões TESTADAS (constraints-<motor>.txt): um PyTorch ou transformers mais novo quebra a voz.
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

# Acha o Python 3.11: no PATH, pelo "py" ou nas pastas onde o instalador do python.org coloca
# (quem não marcou "Add to PATH" também tem o Python 3.11 instalado).
function Achar-Python311 {
    $candidatos = @()
    if (Get-Command py -ErrorAction SilentlyContinue) { $p = (cmd /c "py -3.11 -c ""import sys; print(sys.executable)"" 2>nul" | Out-String).Trim(); if ($p) { $candidatos += $p } }
    $candidatos += "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe", "$env:ProgramFiles\Python311\python.exe", "C:\Python311\python.exe"
    if (Get-Command python -ErrorAction SilentlyContinue) { $candidatos += (Get-Command python).Source }
    foreach ($c in $candidatos) {
        if ($c -and (Test-Path $c)) {
            $v = (cmd /c """$c"" --version 2>&1" | Out-String).Trim()
            if ($v -match "Python 3\.11") { return $c }
        }
    }
    return $null
}

try {
    $base = Achar-Python311
    if (-not $base) {
        throw "Não achei o Python 3.11. O 3.12 ou mais novo NÃO funciona com a voz local. Instale em https://www.python.org/downloads/release/python-3119/ (pode deixar junto de outro Python) e rode este script de novo."
    }
    Write-Host "Python 3.11 OK: $base" -ForegroundColor Green

    $venv = "venv-$Engine"
    $python = Join-Path $venv "Scripts\python.exe"
    $travas = Join-Path $PSScriptRoot "constraints-$Engine.txt"
    if (-not (Test-Path $travas)) { throw "Falta o arquivo constraints-$Engine.txt ao lado deste script. Extraia o ZIP inteiro de novo." }
    if (-not (Test-Path $python)) { Passo "Criando o ambiente $venv" { & $base -m venv $venv } }
    if (-not (Test-Path $python)) { throw "O ambiente $venv não foi criado." }

    Passo "Atualizando o pip" { & $python -m pip install --upgrade pip }

    if ($Engine -eq "xtts") {
        # o PyTorch 2.9 ou mais novo ainda não funciona com o XTTS: usa o 2.8.0 (o testado)
        Passo "Instalando o PyTorch 2.8.0 para CPU (alguns minutos)" { & $python -m pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu }
        Passo "Instalando o XTTS e as bibliotecas de áudio (alguns minutos)" { & $python -m pip install -c $travas coqui-tts numpy soundfile soxr scipy }
        $teste = "from TTS.api import TTS"
    } else {
        Passo "Instalando o Chatterbox e as bibliotecas de áudio (alguns minutos)" { & $python -m pip install -c $travas chatterbox-tts numpy soundfile soxr scipy }
        $teste = "from chatterbox.mtl_tts import ChatterboxMultilingualTTS"
    }

    # só diz que deu certo se o motor IMPORTA de verdade (foi isso que falhou para quem tinha o PyTorch novo)
    Write-Host ""
    Write-Host ">> Conferindo se o $Engine carrega (leva alguns segundos)" -ForegroundColor Cyan
    & $python -c $teste
    if ($LASTEXITCODE -ne 0) { throw "A instalação terminou, mas o $Engine não carrega (veja o erro acima)." }

    Write-Host ""
    Write-Host "Pronto! O $Engine está instalado e carrega." -ForegroundColor Green
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
