# Publica o Conecta TV num Space do Hugging Face (grátis e sem cartão).
#
# Antes: crie a conta em https://huggingface.co e um Space novo do tipo
# "Docker" (nome livre, ex.: conecta-tv). Depois rode este script passando o
# endereço do Space:  usuario/nome-do-space
#
# Uso:  pwsh -File Publicar-No-HuggingFace.ps1 -Space usuario/conecta-tv
param(
    [Parameter(Mandatory=$true)][string]$Space,
    [string]$PastaTemporaria = (Join-Path $env:TEMP 'conecta-tv-space'),
    [switch]$SemPerguntar
)
$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Titulo($texto) { Write-Host ''; Write-Host "  $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  $texto" -ForegroundColor Green }
function Detalhe($texto) { Write-Host "  $texto" -ForegroundColor DarkGray }

if ($Space -notmatch '^[\w.-]+/[\w.-]+$') { throw "Informe no formato usuario/nome-do-space (recebi: $Space)" }
$enderecoHf = 'https://huggingface.co/spaces/' + $Space

Titulo 'Conferindo o acesso ao Hugging Face'
$git = (Get-Command git -ErrorAction SilentlyContinue)?.Source
if (-not $git) { throw 'Git não encontrado. Instale o Git para continuar.' }
Detalhe "Space de destino: $enderecoHf"
Detalhe 'Se pedir usuário e senha, use seu usuário do Hugging Face e um token de acesso (Settings → Access Tokens).'

Titulo 'Baixando o repositório do Space'
if (Test-Path (Join-Path $PastaTemporaria '.git')) {
    & $git -C $PastaTemporaria pull --rebase --autostash
} else {
    if (Test-Path $PastaTemporaria) { throw "A pasta $PastaTemporaria já existe e não é um repositório. Apague ou use -PastaTemporaria." }
    & $git clone "https://huggingface.co/spaces/$Space" $PastaTemporaria
}
Ok "Repositório em $PastaTemporaria"

Titulo 'Copiando o aplicativo'
$excluir = @('node_modules', 'dist', 'android', 'central\android', '.git', 'Legendas', 'relatorios', 'work',
    'config.local.json', 'acessos.json', 'autorizados.json', 'central\dados', 'deploy\servidor\.env')
$argumentos = @($raiz, $PastaTemporaria, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD')
foreach ($item in $excluir) { $argumentos += (Join-Path $raiz $item) }
& robocopy @argumentos | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Cópia falhou (robocopy código $LASTEXITCODE)." }

# O Space precisa destes dois arquivos na raiz dele.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $PastaTemporaria 'README.md') -Force
if (-not (Test-Path (Join-Path $PastaTemporaria 'Dockerfile'))) { throw 'O Dockerfile não foi copiado.' }
Ok 'Arquivos copiados (sem segredos, sem node_modules)'

Titulo 'Enviando para o Hugging Face'
& $git -C $PastaTemporaria add -A
$situacao = & $git -C $PastaTemporaria status --porcelain
if (-not $situacao) { Ok 'Nada mudou desde o último envio.' }
else {
    & $git -C $PastaTemporaria -c user.name='Conecta TV' -c user.email='conectatv@local' commit -m 'Atualiza o Conecta TV no Space' | Out-Null
    & $git -C $PastaTemporaria push origin HEAD
    Ok 'Enviado.'
}

Titulo 'Pronto'
Ok "Endereço do aplicativo: https://$($Space -replace '/', '-').hf.space"
Detalhe 'Na primeira vez, o Space demora alguns minutos para construir a imagem.'
Detalhe "Acompanhe em $enderecoHf (aba Logs)."
Detalhe ''
Detalhe 'Não esqueça de cadastrar os segredos em Settings → Variables and secrets:'
Detalhe '  ACESSO_CODIGO, CENTRAL_KEY, CENTRAL_TOKEN'
