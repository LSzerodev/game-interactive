# Instala a voz clonada LOCAL (opcional). Não precisa disso se usar voz por API ou a voz do Windows.
#   .\setup_voice.ps1 xtts         # Coqui XTTS v2 (uso não comercial)
#   .\setup_voice.ps1 chatterbox   # Chatterbox (MIT)
# Precisa do Python 3.11 (python.org). Cria server\voice\venv-<motor> com PyTorch para CPU.
param([Parameter(Mandatory)][ValidateSet("xtts", "chatterbox")][string]$Engine)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py -3.11" } else { "python" }
$ver = Invoke-Expression "$py --version"
if ($ver -notmatch "3\.11") { throw "Precisa do Python 3.11 (achei: $ver). Instale em https://www.python.org/downloads/" }

$venv = "venv-$Engine"
if (-not (Test-Path $venv)) { Invoke-Expression "$py -m venv $venv" }
$pip = Join-Path $venv "Scripts\pip.exe"
& $pip install --upgrade pip

# o servidor de voz (voice_server.py) e o script de referência usam estes
& $pip install numpy soundfile soxr scipy

if ($Engine -eq "xtts") {
    & $pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    & $pip install coqui-tts
} else {
    & $pip install chatterbox-tts
}
Write-Host "Pronto. No painel (aba Voz) escolha '$Engine' e salve. O primeiro uso baixa o modelo (alguns GB)."
