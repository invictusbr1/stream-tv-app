# Monta o aplicativo do Conecta TV para as televisões Samsung (arquivo .wgt).
#
# O pacote é um .zip com o config.xml na raiz. A assinatura da Samsung é feita
# na hora de instalar (o instalador cria e aplica o certificado da TV).
param(
    [string]$Saida = ''
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
if (-not $Saida) { $Saida = Join-Path $raiz 'dist' }

$fonte = Join-Path $PSScriptRoot 'ConectaTV'
$icone = Join-Path $raiz 'pwa\icon-512.png'
$enderecoJson = Join-Path $raiz 'docs\endereco.json'
if (-not (Test-Path -LiteralPath $fonte)) { throw "Pasta do aplicativo não encontrada: $fonte" }
if (-not (Test-Path -LiteralPath $icone)) { throw "Ícone não encontrado: $icone" }

$endereco = ''
if (Test-Path -LiteralPath $enderecoJson) {
    try { $endereco = [string]((Get-Content -LiteralPath $enderecoJson -Raw | ConvertFrom-Json).endereco) } catch { $endereco = '' }
}

$rascunho = Join-Path $env:TEMP ('conecta-tv-wgt-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $rascunho -Force | Out-Null
Copy-Item -Path (Join-Path $fonte '*') -Destination $rascunho -Recurse -Force
Copy-Item -LiteralPath $icone -Destination (Join-Path $rascunho 'icon.png') -Force

$pagina = Join-Path $rascunho 'index.html'
$texto = Get-Content -LiteralPath $pagina -Raw
if ($endereco) {
    $texto = $texto.Replace('__ENDERECO__', $endereco)
    Write-Output "endereço de reserva: $endereco"
} else {
    $texto = $texto.Replace('__ENDERECO__', '')
    Write-Output 'aviso: sem endereço de reserva (a página fixa continua valendo)'
}
Set-Content -LiteralPath $pagina -Value $texto -Encoding UTF8

New-Item -ItemType Directory -Path $Saida -Force | Out-Null
$wgt = Join-Path $Saida 'ConectaTV.wgt'
if (Test-Path -LiteralPath $wgt) { Remove-Item -LiteralPath $wgt -Force }

# O .wgt é um .zip com os arquivos na raiz — o Windows só cria .zip, então
# criamos como .zip e renomeamos.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipTemporario = Join-Path $Saida 'ConectaTV.zip'
if (Test-Path -LiteralPath $zipTemporario) { Remove-Item -LiteralPath $zipTemporario -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($rascunho, $zipTemporario, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Move-Item -LiteralPath $zipTemporario -Destination $wgt -Force

# Conferência: o config.xml precisa estar na raiz do pacote.
$zip = [System.IO.Compression.ZipFile]::OpenRead($wgt)
try {
    $nomes = $zip.Entries | ForEach-Object { $_.FullName }
    if ($nomes -notcontains 'config.xml') { throw 'O pacote ficou sem o config.xml na raiz.' }
    if ($nomes -notcontains 'index.html') { throw 'O pacote ficou sem a tela inicial.' }
    Write-Output ('arquivos no pacote: ' + ($nomes -join ', '))
} finally { $zip.Dispose() }

Remove-Item -LiteralPath $rascunho -Recurse -Force
$tamanho = [math]::Round((Get-Item -LiteralPath $wgt).Length / 1KB, 1)
Write-Output "pronto: $wgt ($tamanho KB)"
