# Endereço fixo para o Conecta TV e para a Central — caminho recomendado.
#
# Instala o Tailscale (rede privada gratuita) e mostra o endereço fixo que o
# celular vai usar de qualquer lugar, sem abrir porta no roteador e sem
# depender de domínio.
#
# Uso normal:  duplo clique no atalho "Endereço fixo (Tailscale)"
# Conferir:    pwsh -File Endereco-Fixo-Tailscale.ps1 -Conferir
param(
    [switch]$Conferir,
    [switch]$SemEspera
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$pastaStreamTv = Join-Path $env:USERPROFILE '.streamtv'
$instalador = Join-Path $pastaStreamTv 'tailscale-setup.msi'
$urlInstalador = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'
$exeTailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$arquivoEndereco = Join-Path $raiz 'ENDERECO-FIXO.txt'

function Titulo($texto) { Write-Host ''; Write-Host "  $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "  $texto" -ForegroundColor Yellow }
function Detalhe($texto) { Write-Host "  $texto" -ForegroundColor DarkGray }

function Instalado() { return (Test-Path -LiteralPath $exeTailscale) }

function IpFixo() {
    if (-not (Instalado)) { return '' }
    try {
        $ip = (& $exeTailscale ip -4 2>$null | Select-Object -First 1)
        if ($ip) { return $ip.ToString().Trim() }
    } catch { /* ainda não entrou na conta */ }
    return ''
}

function NomeMagico() {
    if (-not (Instalado)) { return '' }
    try {
        $json = (& $exeTailscale status --json 2>$null | Out-String)
        $dados = $json | ConvertFrom-Json
        $nome = [string]$dados.Self.DNSName
        if ($nome) { return $nome.TrimEnd('.') }
    } catch { /* sem nome ainda */ }
    return ''
}

Titulo 'Endereço fixo do Conecta TV (Tailscale)'

if (-not (Instalado)) {
    Detalhe 'O Tailscale ainda não está instalado neste computador.'
    if ($Conferir) {
        Aviso "Instalador pronto: $instalador"
        Detalhe 'Rode sem -Conferir para instalar (vai pedir permissão de administrador).'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $instalador)) {
        Titulo 'Baixando o instalador oficial...'
        New-Item -ItemType Directory -Force -Path $pastaStreamTv | Out-Null
        Invoke-WebRequest -Uri $urlInstalador -OutFile $instalador -UseBasicParsing -TimeoutSec 300
    }
    $assinatura = Get-AuthenticodeSignature -LiteralPath $instalador
    if ($assinatura.Status -ne 'Valid') {
        throw "O instalador não tem assinatura válida ($($assinatura.Status)). Baixe de novo antes de continuar."
    }
    Titulo 'Instalando (vai aparecer o pedido de permissão do Windows)...'
    $processo = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', "`"$instalador`"", '/qb', '/norestart' -Verb RunAs -PassThru -Wait
    if (-not (Instalado)) { throw 'A instalação não terminou. Rode este atalho de novo.' }
    Ok 'Tailscale instalado.'
    Start-Sleep -Seconds 3
}

$ip = IpFixo
$nome = NomeMagico

if (-not $ip) {
    Titulo 'Falta entrar na sua conta do Tailscale'
    Detalhe 'Vai abrir uma página no navegador para você criar a conta (é grátis) ou entrar.'
    Detalhe 'Use a mesma conta no celular depois.'
    if (-not $Conferir) {
        # "tailscale up" mostra o endereço de autorização e espera a confirmação.
        $login = Start-Process -FilePath $exeTailscale -ArgumentList 'up', '--accept-routes' -PassThru -NoNewWindow
        $limite = (Get-Date).AddMinutes(6)
        while (-not $SemEspera -and (Get-Date) -lt $limite) {
            Start-Sleep -Seconds 5
            $ip = IpFixo
            if ($ip) { break }
        }
        if (-not $ip) {
            Aviso 'Ainda não recebi o endereço. Confirme o login no navegador e rode este atalho de novo.'
            exit 0
        }
    } else {
        Aviso 'Sem login ainda: rode este atalho (sem -Conferir) para entrar na conta.'
        exit 0
    }
}

$nome = NomeMagico
Titulo 'Endereço fixo pronto'
Ok "Conecta TV .....: http://${ip}:3000"
Ok "Central ........: http://${ip}:4100"
if ($nome) { Ok "Pelo nome ......: http://${nome}:3000" }
Detalhe ''
Detalhe 'No celular: instale o aplicativo "Tailscale" (Play Store / App Store),'
Detalhe 'entre com a MESMA conta, deixe ligado — e abra o endereço acima no navegador.'
Detalhe 'Funciona em qualquer rede (4G, wi-Fi de outro lugar), sem abrir porta no roteador.'

$conteudo = @(
    'ENDERECO FIXO DO CONECTA TV (Tailscale)',
    '',
    "Conecta TV .....: http://${ip}:3000",
    "Central ........: http://${ip}:4100",
    $(if ($nome) { "Pelo nome ......: http://${nome}:3000" } else { $null }),
    '',
    'No celular: aplicativo Tailscale ligado com a mesma conta.',
    'Nada disso fica exposto na internet: só os seus aparelhos entram.',
    ('Atualizado em ' + (Get-Date).ToString('dd/MM/yyyy HH:mm'))
) | Where-Object { $_ -ne $null }
Set-Content -LiteralPath $arquivoEndereco -Value $conteudo -Encoding utf8
Ok "Anotei tudo em $arquivoEndereco"
