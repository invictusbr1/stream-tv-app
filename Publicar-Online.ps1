# Publica o Conecta TV num endereco https temporario, para abrir no celular fora de casa.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$nuvem = Join-Path $env:USERPROFILE '.streamtv\cloudflared.exe'
if (-not (Test-Path -LiteralPath $nuvem)) { throw "Arquivo cloudflared.exe nao encontrado em $nuvem" }

Write-Host ''
Write-Host '  Iniciando o Conecta TV...' -ForegroundColor Cyan
$servidor = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $raiz -PassThru -WindowStyle Hidden

$log = Join-Path $env:TEMP 'stream-tv-tunel.log'
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
$tunel = Start-Process -FilePath $nuvem -ArgumentList 'tunnel', '--url', 'http://localhost:3000', '--no-autoupdate' -PassThru -WindowStyle Hidden -RedirectStandardError $log

Write-Host '  Abrindo o endereco publico (leva uns 20 segundos)...' -ForegroundColor Cyan
$endereco = $null
for ($i = 0; $i -lt 45 -and -not $endereco; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $log) {
        $achado = [regex]::Match((Get-Content -LiteralPath $log -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($achado.Success) { $endereco = $achado.Value }
    }
}

Write-Host ''
if ($endereco) {
    Write-Host "  Endereco para o celular: $endereco" -ForegroundColor Green
    Write-Host '  Abra no Safari ou no Chrome e use "Adicionar a Tela de Inicio".' -ForegroundColor Gray
    Write-Host '  Este endereco muda toda vez que voce abrir este atalho.' -ForegroundColor DarkGray
}
else {
    Write-Host '  Nao consegui obter o endereco publico. Confira a internet e tente de novo.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  Deixe esta janela aberta enquanto estiver assistindo. Feche para encerrar.' -ForegroundColor Gray
Write-Host ''

try {
    while (-not $servidor.HasExited -and -not $tunel.HasExited) { Start-Sleep -Seconds 2 }
}
finally {
    if ($tunel -and -not $tunel.HasExited) { Stop-Process -Id $tunel.Id -Force -ErrorAction SilentlyContinue }
    if ($servidor -and -not $servidor.HasExited) { Stop-Process -Id $servidor.Id -Force -ErrorAction SilentlyContinue }
    Write-Host '  Acesso encerrado.' -ForegroundColor Gray
}
