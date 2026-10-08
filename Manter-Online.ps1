# Vigia do Conecta TV: mantém o aplicativo e o túnel no ar sozinho.
#
# O que ele faz, a cada minuto:
#   - o aplicativo do PC responde? se não, abre de novo (escondido);
#   - o endereço público ainda responde? se não, abre um túnel novo;
#   - quando o endereço muda, publica na página fixa (GitHub) — o link que
#     você divulga continua o mesmo.
#
# Uso: duplo clique no atalho "Conecta TV - Manter Online" (roda escondido).

param(
    [int]$Porta = 3000,
    [string]$PastaApp = 'C:\Users\tikto\Conecta TV',
    [int]$Intervalo = 60
)

$ErrorActionPreference = 'Continue'
$nuvem = Join-Path $env:USERPROFILE '.streamtv\cloudflared.exe'
$pastaStream = Join-Path $env:USERPROFILE '.streamtv'
$arquivoEndereco = Join-Path $pastaStream 'endereco-atual.txt'
$arquivoLog = Join-Path $pastaStream 'manter-online.log'
$logTunel = Join-Path $pastaStream 'tunel.log'
$arquivoToken = Join-Path $pastaStream 'github-token.txt'
$exeApp = Join-Path $PastaApp 'Conecta TV.exe'

New-Item -ItemType Directory -Force -Path $pastaStream | Out-Null

function Registrar($texto) {
    $linha = '{0}  {1}' -f (Get-Date).ToString('dd/MM HH:mm:ss'), $texto
    try { Add-Content -LiteralPath $arquivoLog -Value $linha -Encoding UTF8 } catch { }
    Write-Host $linha
}
function AppResponde() {
    try { return (Invoke-WebRequest "http://127.0.0.1:$Porta/api/health" -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200 } catch { return $false }
}
function EnderecoResponde($endereco) {
    if (-not $endereco) { return $false }
    try {
        $codigo = curl.exe -s -o NUL -w "%{http_code}" "$endereco/api/health" --max-time 15
        return $codigo -eq '200'
    } catch { return $false }
}
function PublicarEndereco($endereco) {
    if (-not (Test-Path -LiteralPath $arquivoToken)) { return }
    try {
        $token = (Get-Content -LiteralPath $arquivoToken -Raw).Trim()
        $codigo = ''
        $configApp = Join-Path $PastaApp 'config.local.json'
        if (Test-Path -LiteralPath $configApp) {
            try { $codigo = [string]((Get-Content -LiteralPath $configApp -Raw | ConvertFrom-Json).acessoCodigo) } catch { $codigo = '' }
        }
        $cabecalhos = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'conecta-tv-vigia' }
        $conteudo = @{ endereco = $endereco; codigo = $codigo; atualizadoEm = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
        $atual = $null
        try { $atual = Invoke-RestMethod -Uri 'https://api.github.com/repos/invictusbr1/stream-tv-app/contents/docs/endereco.json' -Headers $cabecalhos -Method Get -TimeoutSec 20 } catch { $atual = $null }
        $corpo = @{
            message = 'Atualiza o endereco publico do Conecta TV (vigia automatico)'
            content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($conteudo))
            sha     = $atual.sha
        } | ConvertTo-Json
        Invoke-RestMethod -Uri 'https://api.github.com/repos/invictusbr1/stream-tv-app/contents/docs/endereco.json' -Headers $cabecalhos -Method Put -Body $corpo -ContentType 'application/json' -TimeoutSec 30 | Out-Null
        Registrar "Link fixo atualizado: $endereco"
    } catch {
        Registrar "Nao consegui atualizar o link fixo: $($_.Exception.Message)"
    }
}
function AbrirTunel() {
    if (-not (Test-Path -LiteralPath $nuvem)) { Registrar 'cloudflared.exe nao encontrado'; return '' }
    if (Test-Path -LiteralPath $logTunel) { Remove-Item -LiteralPath $logTunel -Force -ErrorAction SilentlyContinue }
    Registrar 'Abrindo um tunel novo...'
    Start-Process -FilePath $nuvem -ArgumentList 'tunnel', '--url', "http://localhost:$Porta", '--no-autoupdate' -WindowStyle Hidden -RedirectStandardError $logTunel | Out-Null
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path -LiteralPath $logTunel) {
            $achado = [regex]::Match((Get-Content -LiteralPath $logTunel -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
            if ($achado.Success) { return $achado.Value }
        }
    }
    return ''
}

Registrar 'Vigia iniciado. Deixe esta janela escondida — ela cuida do acesso do celular.'

while ($true) {
    # 1. Aplicativo
    if (-not (AppResponde)) {
        Registrar 'O aplicativo nao respondeu — abrindo de novo.'
        if (Test-Path -LiteralPath $exeApp) {
            Start-Process -FilePath $exeApp -WorkingDirectory $PastaApp -WindowStyle Hidden
            for ($i = 0; $i -lt 20 -and -not (AppResponde); $i++) { Start-Sleep -Seconds 3 }
        }
        if (AppResponde) { Registrar 'Aplicativo no ar.' } else { Registrar 'Aplicativo ainda nao respondeu; tento de novo no proximo ciclo.' }
    }

    # 2. Túnel
    $endereco = ''
    if (Test-Path -LiteralPath $arquivoEndereco) { $endereco = (Get-Content -LiteralPath $arquivoEndereco -Raw).Trim() }
    if (-not (EnderecoResponde $endereco)) {
        $novo = AbrirTunel
        if ($novo) {
            Set-Content -LiteralPath $arquivoEndereco -Value $novo -Encoding ASCII
            Registrar "Endereco novo: $novo"
            PublicarEndereco $novo
        } else {
            Registrar 'Nao consegui abrir o tunel agora; tento de novo no proximo ciclo.'
        }
    }

    Start-Sleep -Seconds $Intervalo
}
