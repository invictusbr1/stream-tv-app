param(
    [Parameter(Mandatory=$true)][string]$ApkPath,
    [string]$Notes = 'Atualização do Stream TV.',
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
    $corpo = @{ tag_name = $tag; name = "Stream TV $release"; body = $Notes; draft = $false; prerelease = $false } | ConvertTo-Json
    $existente = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Method Post -Body $corpo -ContentType 'application/json'
}

$upload = "https://uploads.github.com/repos/$repo/releases/$($existente.id)/assets?name=$nome"
Invoke-RestMethod -Uri $upload -Headers $headers -Method Post -InFile $apk -ContentType 'application/vnd.android.package-archive' | Out-Null

$feed = [ordered]@{
    versionCode = $versionCode
    versionName = $release
    apkUrl      = "https://github.com/$repo/releases/download/$tag/$nome"
    sha256      = $sha
    bytes       = $bytes
    notes       = $Notes
}
$conteudo = ($feed | ConvertTo-Json -Depth 3)
$atual = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/contents/latest.json" -Headers $headers -Method Get
$envio = @{ message = "Publica atualização $release"; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($conteudo)); sha = $atual.sha } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/contents/latest.json" -Headers $headers -Method Put -Body $envio -ContentType 'application/json' | Out-Null

Write-Output "Publicado: $release — $nome ($bytes bytes)"
Write-Output "sha256: $sha"
