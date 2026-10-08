# Libera o Conecta TV num endereço público fixo (https) do Tailscale.
#
# Serve para abrir no navegador do iPhone (ou de qualquer aparelho) SEM
# instalar nada nele. Como o endereço fica público, o código de acesso passa a
# ser obrigatório — o script cria/garante esse código.
#
# Uso: duplo clique no atalho "Liberar acesso publico (Funnel)"
param(
    [int]$Porta = 3000,
    [string]$Log
)
$ErrorActionPreference = 'Continue'
$exe = 'C:\Program Files\Tailscale\tailscale.exe'
$pastaApp = 'C:\Users\tikto\Conecta TV'
$configApp = Join-Path $pastaApp 'config.local.json'
if (-not $Log) { $Log = Join-Path $pastaApp 'acesso-publico.log' }

function Anotar($texto) {
    $linha = ('[{0}] {1}' -f (Get-Date).ToString('HH:mm:ss'), $texto)
    Add-Content -LiteralPath $Log -Value $linha -Encoding utf8
    Write-Host $linha
}
Set-Content -LiteralPath $Log -Value '' -Encoding utf8

if (-not (Test-Path -LiteralPath $exe)) { Anotar 'Tailscale não encontrado. Rode antes o atalho "Ligar servidor (Tailscale)".'; exit 1 }

# ---------------------------------------------------------------- código de acesso
$config = @{}
if (Test-Path -LiteralPath $configApp) {
    try { $config = (Get-Content -LiteralPath $configApp -Raw | ConvertFrom-Json) } catch { $config = @{} }
}
$codigo = [string]$config.acessoCodigo
if ($codigo.Length -lt 8) {
    $pedaco = -join ((48..57) + (97..122) | Get-Random -Count 12 | ForEach-Object { [char]$_ })
    $codigo = "tv-$pedaco"
    $config | Add-Member -NotePropertyName acessoCodigo -NotePropertyValue $codigo -Force
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configApp -Encoding utf8
    Anotar "Código de acesso criado: $codigo"
} else {
    Anotar "Usando o código de acesso que já estava configurado"
}

# ---------------------------------------------------------------- reinicia o app
$rodando = $false
try { $rodando = (Invoke-WebRequest "http://127.0.0.1:$Porta/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { }
if ($rodando) {
    Anotar 'Reiniciando o Conecta TV para o código valer'
    Get-CimInstance Win32_Process -Filter "Name='Conecta TV.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 3
}
$exeApp = Join-Path $pastaApp 'Conecta TV.exe'
if (Test-Path -LiteralPath $exeApp) {
    Start-Process -FilePath $exeApp -WorkingDirectory $pastaApp -WindowStyle Hidden
    $limite = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $limite) {
        Start-Sleep -Seconds 3
        try { if ((Invoke-WebRequest "http://127.0.0.1:$Porta/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { break } } catch { }
    }
    Anotar 'Aplicativo no ar com o código de acesso ligado'
}

# ---------------------------------------------------------------- publica
Anotar 'Pedindo ao Tailscale o endereço público (Funnel)'
$saida = (& $exe funnel --bg --https=443 $Porta 2>&1 | Out-String)
Anotar ($saida.Trim())

$situacao = (& $exe funnel status 2>&1 | Out-String)
$achado = [regex]::Match($situacao, 'https://[^\s]+')
if ($achado.Success) {
    Anotar "ENDEREÇO PÚBLICO: $($achado.Value)"
    Anotar "Código de acesso: $codigo"
    Anotar 'Abra esse endereço no Safari do iPhone e informe o código uma vez.'
    Anotar 'PRONTO'
} else {
    Anotar 'O Tailscale não liberou o endereço público ainda.'
    Anotar 'Falta ligar dois itens no painel (é rápido):'
    Anotar '  1. https://login.tailscale.com/admin/dns  ->  HTTPS Certificates: Enable'
    Anotar '  2. https://login.tailscale.com/admin/acls ->  Funnel: marque a opção'
    Anotar 'Depois rode este atalho de novo.'
    exit 2
}
