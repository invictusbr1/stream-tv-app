# Gera um link público (https) para o Conecta TV — abre no Safari do iPhone,
# em qualquer rede, sem instalar nada no aparelho de quem vai assistir.
#
# Usa o Cloudflare (projeto cloudflared, grátis e sem conta). O endereço muda a
# cada vez que você rodar; para endereço fixo use o atalho do Funnel.
#
# Uso: duplo clique no atalho "Link publico (temporario)"
param(
    [int]$Porta = 3000,
    [string]$PastaApp = 'C:\Users\tikto\Conecta TV'
)
$ErrorActionPreference = 'Continue'
$nuvem = Join-Path $env:USERPROFILE '.streamtv\cloudflared.exe'
$log = Join-Path $env:TEMP 'conecta-link-publico.log'
$configApp = Join-Path $PastaApp 'config.local.json'

function Titulo($texto) { Write-Host ''; Write-Host "  $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "  $texto" -ForegroundColor Yellow }
function Detalhe($texto) { Write-Host "  $texto" -ForegroundColor DarkGray }

if (-not (Test-Path -LiteralPath $nuvem)) { Aviso "cloudflared.exe não encontrado em $nuvem"; exit 1 }

Titulo 'Garantindo que o Conecta TV está no ar'
$noAr = $false
try { $noAr = (Invoke-WebRequest "http://127.0.0.1:$Porta/api/health" -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200 } catch { }
if (-not $noAr) {
    $exeApp = Join-Path $PastaApp 'Conecta TV.exe'
    if (Test-Path -LiteralPath $exeApp) {
        Start-Process -FilePath $exeApp -WorkingDirectory $PastaApp -WindowStyle Hidden
        $limite = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $limite -and -not $noAr) {
            Start-Sleep -Seconds 3
            try { $noAr = (Invoke-WebRequest "http://127.0.0.1:$Porta/api/health" -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200 } catch { }
        }
    }
}
if ($noAr) { Ok 'Aplicativo no ar' } else { Aviso 'O aplicativo não respondeu — abra o atalho Conecta TV e tente de novo'; exit 1 }

Titulo 'Abrindo o endereço público (leva uns 20 segundos)'
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
$tunel = Start-Process -FilePath $nuvem -ArgumentList 'tunnel', '--url', "http://localhost:$Porta", '--no-autoupdate' -PassThru -WindowStyle Hidden -RedirectStandardError $log

$endereco = ''
for ($i = 0; $i -lt 45 -and -not $endereco; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $log) {
        $achado = [regex]::Match((Get-Content -LiteralPath $log -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($achado.Success) { $endereco = $achado.Value }
    }
}
if (-not $endereco) { Aviso 'Não consegui obter o endereço. Veja o arquivo ' + $log; exit 1 }

# Código de acesso (obrigatório em endereço público).
$codigo = ''
if (Test-Path -LiteralPath $configApp) {
    try { $codigo = [string]((Get-Content -LiteralPath $configApp -Raw | ConvertFrom-Json).acessoCodigo) } catch { $codigo = '' }
}

Titulo 'LINK PRONTO PARA O CELULAR'
Ok "Link .......: $endereco"
if ($codigo) { Ok "Código .....: $codigo" } else { Aviso 'Nenhum código de acesso configurado: qualquer pessoa com o link entra.' }
Detalhe ''
Detalhe 'Mande o link para quem vai assistir. No iPhone: abre no Safari, digita o código'
Detalhe 'uma vez e pronto (pode usar "Adicionar à Tela de Início").'

try { Set-Clipboard -Value $endereco; Ok 'O link já está copiado — é só colar no WhatsApp.' } catch { }

# Testa por fora (pela borda da Cloudflare) para confirmar que o mundo enxerga.
try {
    $ips = (Resolve-DnsName ([uri]$endereco).Host -Server 1.1.1.1 -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 1 -ExpandProperty IPAddress)
    if ($ips) {
        $teste = curl.exe -s -o NUL -w "%{http_code}" --resolve "$(([uri]$endereco).Host):443:$ips" "$endereco/api/health" --max-time 25
        if ($teste -eq '200') { Ok 'Teste de fora: o link respondeu 200 (funcionando)' } else { Aviso "Teste de fora devolveu HTTP $teste" }
    }
} catch { Detalhe 'Não deu para testar de fora agora, mas o link deve funcionar no celular.' }

Detalhe ''
Detalhe 'Deixe esta janela aberta enquanto estiver assistindo.'
Detalhe 'Quando fechar, o link deixa de funcionar.'
Wait-Process -Id $tunel.Id
Detalhe 'Túnel encerrado.'
