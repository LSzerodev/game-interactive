# Sobe o servidor da live e abre o painel (e o jogo, se achar o Godot ou o Live3D.exe).
# Para abrir pelo editor do Godot, defina GODOT_EXE com o caminho do executável do Godot 4.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$server = Join-Path $root "server"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ nao encontrado. Baixe em https://nodejs.org" }
if (-not (Test-Path (Join-Path $server "node_modules"))) { Push-Location $server; npm install; Pop-Location }
if (-not (Test-Path (Join-Path $server ".env"))) {
    Copy-Item (Join-Path $server ".env.example") (Join-Path $server ".env")
    Write-Host "Criei server\.env. Voce tambem pode configurar tudo pelo painel."
}

$srv = Start-Process node -ArgumentList "src/index.js" -WorkingDirectory $server -PassThru -NoNewWindow
Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:9393"

$exe = Join-Path $root "Live3D.exe"
if ($env:GODOT_EXE -and (Test-Path $env:GODOT_EXE)) {
    Start-Process $env:GODOT_EXE -ArgumentList "--path", "`"$(Join-Path $root 'game')`""
} elseif (Test-Path $exe) {
    Start-Process $exe
} else {
    Write-Host "Abra a pasta game no Godot 4 (ou defina GODOT_EXE), ou baixe o Live3D.exe em Releases."
}
Write-Host "Servidor rodando (PID $($srv.Id)). Ctrl+C para encerrar."
Wait-Process -Id $srv.Id
