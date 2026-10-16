param(
    [Parameter(Mandatory=$true)][string]$ApkPath,
    [string]$ApkTvPath = '',
    [string]$ExePath = '',
    [string]$Notes = 'Atualização do Conecta TV.',
    [string]$Token = ''
)
$ErrorActionPreference = 'Stop'
$repo = 'invictusbr1/stream-tv-atualizacoes'
$arquivoToken = Join-Path $env:USERPROFILE '.streamtv\github-token.txt'
if (-not $Token) { $Token = $env:GITHUB_TOKEN }
if (-not $Token -and (Test-Path -LiteralPath $arquivoToken)) { $Token = (Get-Content -LiteralPath $arquivoToken -Raw).Trim() }
if (-not $Token) { throw "Token do GitHub não encontrado. Salve o token em $arquivoToken" }

$apk = (Resolve-Path -LiteralPath $ApkPath).Path
$gradle = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app\build.gradle') -Raw
$versionCode = [int][regex]::Match($gradle, "versionCode\s+(\d+)").Groups[1].Value
$versionName = [regex]::Match($gradle, "versionName\s+'([^']+)'").Groups[1].Value
if (-not $versionCode -or -not $versionName) { throw 'versionCode/versionName não encontrados em app/build.gradle.' }
$release = $versionName -replace '-teste$', ''
$tag = "v$release"
$nome = Split-Path $apk -Leaf
$bytes = (Get-Item -LiteralPath $apk).Length
$sha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLower()
$headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'stream-tv-publicador' }

$existente = $null
try { $existente = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers -Method Get } catch { $existente = $null }
if ($existente) {
    foreach ($asset in $existente.assets) {
        if ($asset.name -eq $nome) { Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/assets/$($asset.id)" -Headers $headers -Method Delete | Out-Null }
    }
}
else {
    $corpo = @{ tag_name = $tag; name = "Conecta TV $release"; body = $Notes; draft = $false; prerelease = $false } | ConvertTo-Json
    $existente = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Method Post -Body $corpo -ContentType 'application/json'
}

# Sobe um arquivo para a versão publicada (apagando antes o de mesmo nome).
function Enviar-Arquivo([string]$caminho, [string]$tipo) {
    $arquivoNome = Split-Path $caminho -Leaf
    foreach ($asset in $existente.assets) {
        if ($asset.name -eq $arquivoNome) {
            # Apagar o arquivo antigo é limpeza: se ele já não existe (404), segue.
            try { Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/assets/$($asset.id)" -Headers $headers -Method Delete | Out-Null } catch { }
        }
    }
    $destino = "https://uploads.github.com/repos/$repo/releases/$($existente.id)/assets?name=$arquivoNome"
    # O envio de arquivo grande (o instalador do computador) pode cair no meio:
    # tenta de novo até três vezes antes de desistir.
    $enviado = $false
    for ($tentativa = 1; $tentativa -le 3 -and -not $enviado; $tentativa++) {
        try {
            Invoke-RestMethod -Uri $destino -Headers $headers -Method Post -InFile $caminho -ContentType $tipo | Out-Null
            $enviado = $true
        } catch {
            if ($tentativa -eq 3) { throw }
            Write-Output "Reenviando $arquivoNome (tentativa $($tentativa + 1))…"
            Start-Sleep -Seconds 5
        }
    }
    Write-Output "Enviado: $arquivoNome"
}

Enviar-Arquivo $apk 'application/vnd.android.package-archive'

# Preserve download channels that are not being rebuilt in this publication.
$manifestoAntes = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/contents/latest.json?ref=main" -Headers $headers -Method Get
$feedAntes = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($manifestoAntes.content)) | ConvertFrom-Json
$feed = [ordered]@{
    versionCode = $versionCode
    versionName = $release
    apkUrl      = "https://github.com/$repo/releases/download/$tag/$nome"
    sha256      = $sha
    bytes       = $bytes
    notes       = $Notes
}

foreach ($campo in @('exeUrl','exeSha256','exeBytes','apkTvUrl','apkTvSha256','apkTvBytes')) {
    if ($feedAntes.PSObject.Properties.Name -contains $campo) { $feed[$campo] = $feedAntes.$campo }
}

# O aplicativo da TV tem pacote próprio e recebe o APK dele no mesmo aviso.
if ($ApkTvPath) {
    $apkTv = (Resolve-Path -LiteralPath $ApkTvPath).Path
    $nomeTv = Split-Path $apkTv -Leaf
    $feed.apkTvUrl = "https://github.com/$repo/releases/download/$tag/$nomeTv"
    $feed.apkTvSha256 = (Get-FileHash -LiteralPath $apkTv -Algorithm SHA256).Hash.ToLower()
    $feed.apkTvBytes = (Get-Item -LiteralPath $apkTv).Length
    Enviar-Arquivo $apkTv 'application/vnd.android.package-archive'
    Write-Output "APK da TV: $nomeTv ($($feed.apkTvBytes) bytes)"
}

# O instalador do computador também entra na versão publicada.
if ($ExePath) {
    $exe = (Resolve-Path -LiteralPath $ExePath).Path
    $nomeExe = Split-Path $exe -Leaf
    $feed.exeUrl = "https://github.com/$repo/releases/download/$tag/$nomeExe"
    $feed.exeSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLower()
    $feed.exeBytes = (Get-Item -LiteralPath $exe).Length
    Enviar-Arquivo $exe 'application/octet-stream'
    Write-Output "Instalador do computador: $nomeExe ($($feed.exeBytes) bytes)"
}

$conteudo = ($feed | ConvertTo-Json -Depth 3)
$atual = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/contents/latest.json" -Headers $headers -Method Get
$envio = @{ message = "Publica atualização $release"; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($conteudo)); sha = $atual.sha } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/contents/latest.json" -Headers $headers -Method Put -Body $envio -ContentType 'application/json' | Out-Null

# Keep the app's GitHub Pages fallback feed in sync with the primary update feed.
$repoApp = 'invictusbr1/stream-tv-app'
$feedReserva = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoApp/contents/docs/latest.json" -Headers $headers -Method Get
$envioReserva = @{ message = "Atualiza aviso Android $release"; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($conteudo)); sha = $feedReserva.sha } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/$repoApp/contents/docs/latest.json" -Headers $headers -Method Put -Body $envioReserva -ContentType 'application/json' | Out-Null
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\latest.json'), $conteudo, [Text.UTF8Encoding]::new($false))

# Confere o manifesto publicado de verdade (o script já subiu o APK sem
# atualizar o aviso uma vez; esta conferência evita repetir o erro).
$publicado = $null
for ($tentativa = 1; $tentativa -le 6; $tentativa++) {
    Start-Sleep -Seconds 3
    try { $publicado = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$repo/main/latest.json" -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json } catch { $publicado = $null }
    if ($publicado -and [int]$publicado.versionCode -eq $versionCode) { break }
}
if (-not $publicado -or [int]$publicado.versionCode -ne $versionCode) {
    # O CDN raw pode manter a versão anterior por cinco minutos. Confere o
    # conteúdo efetivamente gravado, sem tratar esse atraso como envio falho.
    $gravado = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/contents/latest.json?ref=main" -Headers $headers -Method Get
    $publicado = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($gravado.content)) | ConvertFrom-Json
    if ([int]$publicado.versionCode -ne $versionCode -or $publicado.sha256 -ne $feed.sha256 -or ($ApkTvPath -and $publicado.apkTvSha256 -ne $feed.apkTvSha256) -or ($ExePath -and $publicado.exeSha256 -ne $feed.exeSha256)) {
        throw "O manifesto gravado não confere com a versão $versionCode. Confira https://github.com/$repo/blob/main/latest.json"
    }
    Write-Output 'Manifesto gravado e hashes conferidos; o cache do aviso automatico ainda pode mostrar a versao anterior.'
}
if ($ApkTvPath -and -not $publicado.apkTvUrl) { throw 'O manifesto publicado ficou sem o endereço do APK da TV.' }

Write-Output "Publicado: $release - $nome ($bytes bytes)"
Write-Output "sha256: $sha"
if ($ApkTvPath) { Write-Output "TV: $($publicado.apkTvUrl)" }
Write-Output "Manifesto conferido: versionCode $($publicado.versionCode), versionName $($publicado.versionName)"
