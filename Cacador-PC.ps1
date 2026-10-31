# Abre o tunel ate a Central (sem abrir o navegador), para o cacador do PC
# saber quais titulos falharam. Mesmo esquema do Abrir-Central.ps1.
$ErrorActionPreference = 'Continue'
$cfgPath = Join-Path $env:USERPROFILE '.conecta-tv-vm.json'
$porta = 4100
function TunelAtivo {
    try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('127.0.0.1', $porta); $t.Close(); return $true } catch { return $false }
}
if (TunelAtivo) { Write-Host "  Tunel da Central ja aberto." -ForegroundColor Green; return }
if (-not (Test-Path $cfgPath)) { Write-Host "  Sem configuracao do servidor; o cacador roda so com as novelas." -ForegroundColor Yellow; return }
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
Write-Host "  Abrindo o tunel ate a Central..." -ForegroundColor Yellow
Start-Process -FilePath 'ssh' -ArgumentList @('-i', $cfg.chave, '-N', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-L', "${porta}:127.0.0.1:${porta}", "ubuntu@$($cfg.ip)") -WindowStyle Hidden
for ($i = 1; $i -le 20; $i++) { Start-Sleep -Milliseconds 1000; if (TunelAtivo) { Write-Host "  Tunel aberto." -ForegroundColor Green; return } }
Write-Host "  O tunel nao abriu; o cacador roda so com as novelas." -ForegroundColor Yellow
