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
try { Restart-Service -Name Tailscale -Force -ErrorAction Stop; Anotar 'Serviço reiniciado'; Start-Sleep -Seconds 6 }
catch { Anotar "Não consegui reiniciar o serviço: $($_.Exception.Message)" }

function EnderecoAtual() {
    try { return (& $exe ip -4 2>$null | Select-Object -First 1) } catch { return '' }
}

$ip = EnderecoAtual

# Depois de um reinício o Tailscale pode voltar sem sessão ("NoState"). Nesse
# caso é preciso entrar de novo: o comando "up" mostra o endereço de login.
if (-not $ip) {
    Anotar 'Sem endereço ainda: refazendo a entrada na conta (pode abrir o navegador)'
    $saida = Join-Path $env:TEMP 'conecta-tailscale-up.txt'
    $erro = Join-Path $env:TEMP 'conecta-tailscale-up-erro.txt'
    Set-Content -LiteralPath $saida -Value '' -Encoding utf8
    Set-Content -LiteralPath $erro -Value '' -Encoding utf8
    $processo = Start-Process -FilePath $exe -ArgumentList 'up', '--accept-routes' -PassThru -NoNewWindow -RedirectStandardOutput $saida -RedirectStandardError $erro
    $jaAbriu = $false
    for ($i = 0; $i -lt 40 -and -not $ip; $i++) {
        Start-Sleep -Seconds 3
        $texto = (Get-Content -LiteralPath $saida -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $erro -Raw -ErrorAction SilentlyContinue)
        $achado = [regex]::Match([string]$texto, 'https://login\.tailscale\.com/[^\s]+')
        if (-not $jaAbriu -and $achado.Success) {
            Anotar "Endereço de login: $($achado.Value)"
            try { Start-Process $achado.Value; Anotar 'Abri a página de login no navegador. Entre com a mesma conta de antes.' } catch { }
            $jaAbriu = $true
        }
        $ip = EnderecoAtual
    }
    if (-not $processo.HasExited) { Stop-Process -Id $processo.Id -Force -ErrorAction SilentlyContinue }
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
