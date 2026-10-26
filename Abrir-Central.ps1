# Abre a Central do Conecta TV no navegador.
# Cria o tunel SSH se ainda nao existir e abre o painel ja logado.
# Escrito para funcionar no PowerShell 5.1 E no 7 (so ASCII, sem "&&").

$ErrorActionPreference = 'Continue'
$cfgPath = Join-Path $env:USERPROFILE '.conecta-tv-vm.json'
$chavePainel = 'PQnYImIbflK2JbnmLr9Vs49d'
$porta = 4100

Write-Host ""
Write-Host "  Central do Conecta TV" -ForegroundColor Cyan
Write-Host "  ---------------------" -ForegroundColor Cyan

if (-not (Test-Path $cfgPath)) {
    Write-Host "  Nao achei a configuracao. Rode o Diagnostico-ConectaTV.cmd primeiro." -ForegroundColor Red
    Start-Sleep -Seconds 4
    return
}
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$ip = $cfg.ip
$chave = $cfg.chave

# O tunel ja esta de pe? (alguem escutando na porta)
function TunelAtivo {
    try {
        $t = New-Object System.Net.Sockets.TcpClient
        $t.Connect('127.0.0.1', $porta)
        $t.Close()
        return $true
    } catch { return $false }
}

if (TunelAtivo) {
    Write-Host "  Tunel ja estava aberto. Abrindo o painel..." -ForegroundColor Green
} else {
    Write-Host "  Abrindo o tunel ate o servidor $ip ..." -ForegroundColor Yellow
    Start-Process -FilePath 'ssh' -ArgumentList @(
        '-i', $chave,
        '-N',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30',
        '-L', "${porta}:127.0.0.1:${porta}",
        "ubuntu@$ip"
    ) -WindowStyle Hidden

    # Espera o tunel ficar pronto (ate 20 segundos)
    $pronto = $false
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Milliseconds 1000
        if (TunelAtivo) { $pronto = $true; break }
        Write-Host ("  aguardando... {0}s" -f $i) -ForegroundColor DarkGray
    }
    if (-not $pronto) {
        Write-Host ""
        Write-Host "  O tunel nao abriu em 20 segundos." -ForegroundColor Red
        Write-Host "  Verifique se o servidor esta no ar e se a chave existe:" -ForegroundColor Yellow
        Write-Host "    $chave" -ForegroundColor DarkGray
        Start-Sleep -Seconds 6
        return
    }
    Write-Host "  Tunel aberto." -ForegroundColor Green
}

# Abre o painel ja autenticado. O endereco fica salvo no navegador.
$endereco = "http://127.0.0.1:$porta/entrar?chave=$chavePainel"
Start-Process $endereco
Write-Host ""
Write-Host "  Painel aberto no navegador." -ForegroundColor Green
Write-Host "  O tunel continua aberto em segundo plano." -ForegroundColor DarkGray
Write-Host "  Para fechar: encerrar o processo ssh (ou reiniciar o PC)." -ForegroundColor DarkGray
Start-Sleep -Seconds 3
