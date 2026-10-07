# Endereço fixo PÚBLICO (https) para o Conecta TV e a Central.
#
# Use este caminho quando quiser abrir em qualquer aparelho (TV, computador de
# outra casa, navegador de quem você autorizar) sem instalar nada nele.
# Precisa de um domínio seu apontado para o Cloudflare (o domínio é a única
# parte paga; o túnel em si é grátis).
#
# Uso:  pwsh -File Endereco-Fixo-Cloudflare.ps1 -Endereco tv.seudominio.com
#       (opcional) -EnderecoCentral painel.seudominio.com
param(
    [Parameter(Mandatory=$true)][string]$Endereco,
    [string]$EnderecoCentral = '',
    [string]$NomeTunel = 'conecta-tv',
    [int]$PortaApp = 3000,
    [int]$PortaCentral = 4100
)
$ErrorActionPreference = 'Stop'
$nuvem = Join-Path $env:USERPROFILE '.streamtv\cloudflared.exe'
$pastaConfig = Join-Path $env:USERPROFILE '.cloudflared'
$arquivoConfig = Join-Path $pastaConfig 'config.yml'

function Titulo($texto) { Write-Host ''; Write-Host "  $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  $texto" -ForegroundColor Green }
function Detalhe($texto) { Write-Host "  $texto" -ForegroundColor DarkGray }

if (-not (Test-Path -LiteralPath $nuvem)) { throw "cloudflared.exe não encontrado em $nuvem" }
if ($Endereco -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { throw "Endereço inválido: $Endereco" }
if ($EnderecoCentral -and $EnderecoCentral -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { throw "Endereço da central inválido: $EnderecoCentral" }

Titulo 'Endereço fixo público (Cloudflare Tunnel)'
Detalhe 'O navegador vai abrir para você autorizar o domínio no Cloudflare.'
Detalhe 'Se ainda não tem domínio no Cloudflare, crie a conta grátis e aponte o domínio antes de continuar.'

$certificado = Join-Path $pastaConfig 'cert.pem'
if (-not (Test-Path -LiteralPath $certificado)) {
    & $nuvem tunnel login
    if ($LASTEXITCODE -ne 0) { throw 'Login não concluído.' }
}

$lista = (& $nuvem tunnel list 2>$null | Out-String)
if ($lista -notmatch "(?m)\b$([regex]::Escape($NomeTunel))\b") {
    Titulo "Criando o túnel $NomeTunel..."
    & $nuvem tunnel create $NomeTunel
    if ($LASTEXITCODE -ne 0) { throw 'Não consegui criar o túnel.' }
}

$json = (& $nuvem tunnel list --output json 2>$null | Out-String)
$tunel = $null
try { $tunel = ($json | ConvertFrom-Json) | Where-Object { $_.name -eq $NomeTunel } | Select-Object -First 1 } catch { }
if (-not $tunel) { throw 'Não encontrei o túnel criado.' }
$idTunel = $tunel.id
$credenciais = Join-Path $pastaConfig "$idTunel.json"
if (-not (Test-Path -LiteralPath $credenciais)) { throw "Arquivo de credenciais não encontrado: $credenciais" }

Titulo 'Apontando os endereços para o túnel...'
& $nuvem tunnel route dns $NomeTunel $Endereco
if ($EnderecoCentral) { & $nuvem tunnel route dns $NomeTunel $EnderecoCentral }

$linhas = @(
    "tunnel: $idTunel",
    "credentials-file: $($credenciais -replace '\\','/')",
    '',
    'ingress:',
    "  - hostname: $Endereco",
    "    service: http://localhost:$PortaApp",
    $(if ($EnderecoCentral) { "  - hostname: $EnderecoCentral`n    service: http://localhost:$PortaCentral" }),
    '  - service: http_status:404'
) | Where-Object { $_ -ne $null }
New-Item -ItemType Directory -Force -Path $pastaConfig | Out-Null
Set-Content -LiteralPath $arquivoConfig -Value $linhas -Encoding utf8
Ok "Configuração escrita em $arquivoConfig"

Titulo 'Instalando como serviço do Windows (liga junto com o computador)...'
try {
    & $nuvem service install 2>$null | Out-Null
    Start-Service cloudflared -ErrorAction SilentlyContinue
    Ok 'Serviço instalado.'
} catch {
    Detalhe 'Não consegui instalar como serviço (precisa de administrador).'
    Detalhe "Rode manualmente:  `"$nuvem`" tunnel run $NomeTunel"
}

Titulo 'Endereço fixo pronto'
Ok "Conecta TV .....: https://$Endereco"
if ($EnderecoCentral) { Ok "Central ........: https://$EnderecoCentral" }
Detalhe ''
Detalhe 'Estes endereços não mudam mais. No aplicativo, mantenha o código de acesso'
Detalhe '(ACESSO_CODIGO) ligado: como é público, qualquer pessoa que descobrir o'
Detalhe 'endereço precisa do código para entrar.'
