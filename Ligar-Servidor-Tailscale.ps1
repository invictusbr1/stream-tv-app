# Liga o Conecta TV como servidor na rede privada do Tailscale.
#
# Faz tudo numa passada:
#   1. instala o Tailscale (se ainda não estiver);
#   2. libera as portas 3000 e 4100 no firewall do Windows;
#   3. entra na sua conta (abre o navegador) e espera a confirmação;
#   4. mostra o endereço fixo que o celular vai usar.
#
# Uso:  duplo clique no atalho "Ligar servidor (Tailscale)"
# Log:  fica em %TEMP%\conecta-tailscale.log (ajude a diagnosticar se falhar)
param(
    [string]$Log,
    [switch]$SemEspera,
    [int]$MinutosDeEspera = 6
)
$ErrorActionPreference = 'Continue'
if (-not $Log) { $Log = Join-Path $PSScriptRoot 'ligar-servidor.log' }
$instalador = Join-Path $env:USERPROFILE '.streamtv\tailscale-setup.msi'
$urlInstalador = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'
$exe = 'C:\Program Files\Tailscale\tailscale.exe'

function Anotar($texto) {
    $linha = ('[{0}] {1}' -f (Get-Date).ToString('HH:mm:ss'), $texto)
    Add-Content -LiteralPath $Log -Value $linha
    Write-Host $linha
}
Set-Content -LiteralPath $Log -Value '' -Encoding utf8
Anotar "Início: preparando o servidor na rede privada"

# ------------------------------------------------------------------ 1. Tailscale
if (-not (Test-Path -LiteralPath $exe)) {
    if (-not (Test-Path -LiteralPath $instalador)) {
        Anotar 'Baixando o instalador oficial do Tailscale'
        New-Item -ItemType Directory -Force -Path (Split-Path $instalador) | Out-Null
        Invoke-WebRequest -Uri $urlInstalador -OutFile $instalador -UseBasicParsing -TimeoutSec 300
    }
    Anotar 'Instalando o Tailscale (aguarde)'
    $processo = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', "`"$instalador`"", '/qb', '/norestart' -PassThru -Wait
    if (-not (Test-Path -LiteralPath $exe)) { Anotar "FALHOU ao instalar (código $($processo.ExitCode))"; exit 1 }
    Anotar 'Tailscale instalado'
    Start-Sleep -Seconds 5
} else {
    Anotar 'Tailscale já estava instalado'
}

# ------------------------------------------------------------------ 2. Firewall
foreach ($porta in 3000, 4100) {
    $nome = "Conecta TV porta $porta"
    Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $nome -Direction Inbound -Action Allow -Protocol TCP -LocalPort $porta -Profile Any -ErrorAction SilentlyContinue | Out-Null
}
Anotar 'Portas 3000 e 4100 liberadas no firewall do Windows'

# ------------------------------------------------------------------ 3. Login
$ip = ''
try { $ip = (& $exe ip -4 2>$null | Select-Object -First 1) } catch { }
if (-not $ip) {
    Anotar 'Abrindo a página de login do Tailscale no navegador'
    $login = Start-Process -FilePath $exe -ArgumentList 'up', '--accept-routes' -PassThru -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP 'conecta-tailscale-erro.log') -RedirectStandardOutput (Join-Path $env:TEMP 'conecta-tailscale-saida.log')
    Start-Sleep -Seconds 6
    $texto = ''
    foreach ($arquivo in @((Join-Path $env:TEMP 'conecta-tailscale-saida.log'), (Join-Path $env:TEMP 'conecta-tailscale-erro.log'))) {
        if (Test-Path $arquivo) { $texto += (Get-Content -LiteralPath $arquivo -Raw) }
    }
    $achado = [regex]::Match($texto, 'https://login\.tailscale\.com/[^\s]+')
    if ($achado.Success) {
        Anotar "Endereço de login: $($achado.Value)"
        Start-Process $achado.Value
    } else {
        Anotar 'Não achei o endereço de login no retorno; abra o ícone do Tailscale na bandeja do Windows.'
    }
    $limite = (Get-Date).AddMinutes($MinutosDeEspera)
    while (-not $SemEspera -and (Get-Date) -lt $limite) {
        Start-Sleep -Seconds 5
        try { $ip = (& $exe ip -4 2>$null | Select-Object -First 1) } catch { $ip = '' }
        if ($ip) { break }
    }
}

if (-not $ip) {
    Anotar 'AINDA SEM LOGIN: entre na conta no navegador e rode este atalho de novo'
    exit 2
}

$nome = ''
try {
    $json = (& $exe status --json 2>$null | Out-String) | ConvertFrom-Json
    $nome = [string]$json.Self.DNSName
} catch { }

Anotar "ENDEREÇO FIXO: $ip"
if ($nome) { Anotar "PELO NOME: $($nome.TrimEnd('.'))" }
Anotar "Conecta TV: http://${ip}:3000"
Anotar "Central...: http://${ip}:4100"

# ------------------------------------------------------------------ 4. Servidores
# Um clique liga tudo: aplicativo, central e o endereço para o celular.
function Respondendo($endereco) {
    try { return (Invoke-WebRequest -Uri $endereco -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200 } catch { return $false }
}
$atalhoApp = 'C:\Users\tikto\Conecta TV\Conecta TV.exe'
$atalhoCentral = 'C:\Users\tikto\Conecta TV Central\Central Conecta TV.exe'

if (-not (Respondendo 'http://127.0.0.1:3000/api/health')) {
    if (Test-Path -LiteralPath $atalhoApp) {
        Anotar 'Ligando o aplicativo Conecta TV'
        Start-Process -FilePath $atalhoApp -WorkingDirectory (Split-Path $atalhoApp) -WindowStyle Hidden
    } else { Anotar 'Aviso: não achei o programa do Conecta TV' }
}
if (-not (Respondendo 'http://127.0.0.1:4100/api/health')) {
    if (Test-Path -LiteralPath $atalhoCentral) {
        Anotar 'Ligando a central'
        Start-Process -FilePath $atalhoCentral -WorkingDirectory (Split-Path $atalhoCentral) -WindowStyle Hidden
    } else { Anotar 'Aviso: não achei o programa da central' }
}

$limite = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $limite -and -not (Respondendo 'http://127.0.0.1:3000/api/health')) { Start-Sleep -Seconds 3 }
Anotar $(if (Respondendo 'http://127.0.0.1:3000/api/health') { 'Aplicativo no ar' } else { 'O aplicativo ainda não respondeu — abra o atalho Conecta TV' })
Anotar $(if (Respondendo 'http://127.0.0.1:4100/api/health') { 'Central no ar' } else { 'A central ainda não respondeu — abra o atalho Central Conecta TV' })

Anotar 'Para o celular (com o Tailscale ligado):'
Anotar "  Conecta TV: http://${ip}:3000"
Anotar "  Central...: http://${ip}:4100"
Anotar 'PRONTO'
