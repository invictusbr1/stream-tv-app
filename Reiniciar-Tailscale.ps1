# Reinicia o Tailscale e mostra o endereço fixo do PC.
#
# Serve para quando o Tailscale "dorme" ou perde a conexão (aparece
# "no current Tailscale IPs" ou "Unable to connect to the coordination server").
param([string]$Log)
$ErrorActionPreference = 'Continue'
if (-not $Log) { $Log = 'C:\Users\tikto\Conecta TV\reiniciar-tailscale.log' }
function Anotar($texto) {
    $linha = ('[{0}] {1}' -f (Get-Date).ToString('HH:mm:ss'), $texto)
    Add-Content -LiteralPath $Log -Value $linha -Encoding utf8
    Write-Host $linha
}
Set-Content -LiteralPath $Log -Value '' -Encoding utf8
$exe = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path -LiteralPath $exe)) { Anotar 'Tailscale não está instalado neste PC.'; exit 1 }

Anotar 'Reiniciando o serviço do Tailscale...'
try { Restart-Service -Name Tailscale -Force -ErrorAction Stop; Anotar 'Serviço reiniciado' }
catch { Anotar "Não consegui reiniciar o serviço: $($_.Exception.Message)" }

$ip = ''
for ($i = 0; $i -lt 30 -and -not $ip; $i++) {
    Start-Sleep -Seconds 3
    try { $ip = (& $exe ip -4 2>$null | Select-Object -First 1) } catch { $ip = '' }
}

if (-not $ip) {
    Anotar 'Ainda sem endereço. Se continuar assim, abra o ícone do Tailscale na bandeja do Windows e entre na conta.'
    exit 2
}
$nome = ''
try { $nome = [string](((& $exe status --json 2>$null | Out-String) | ConvertFrom-Json).Self.DNSName) } catch { }
Anotar "Endereço fixo: $ip"
if ($nome) { Anotar "Pelo nome: $($nome.TrimEnd('.'))" }
Anotar "Conecta TV: http://${ip}:3000"
Anotar "Central...: http://${ip}:4100"
Anotar 'PRONTO'
