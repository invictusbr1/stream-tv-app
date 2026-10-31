# Libera para a familia toda a versao que esta no canal de teste.
$ErrorActionPreference = 'Stop'
$repo = 'invictusbr1/stream-tv-atualizacoes'
$repoApp = 'invictusbr1/stream-tv-app'
$token = (Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.streamtv\github-token.txt') -Raw).Trim()
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'stream-tv-publicador' }
function Ler($r, $arquivo) { $x = Invoke-RestMethod -Uri "https://api.github.com/repos/$r/contents/$arquivo" -Headers $headers -Method Get; return @{ sha = $x.sha; dados = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($x.content)) | ConvertFrom-Json) } }
function Gravar($r, $arquivo, $sha, $conteudo, $msg) { $b = @{ message = $msg; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($conteudo)); sha = $sha } | ConvertTo-Json; Invoke-RestMethod -Uri "https://api.github.com/repos/$r/contents/$arquivo" -Headers $headers -Method Put -Body $b -ContentType 'application/json' | Out-Null }
$teste = Ler $repo 'latest-teste.json'
$principal = Ler $repo 'latest.json'
if ([int]$teste.dados.versionCode -le [int]$principal.dados.versionCode) { Write-Output "Nada para liberar: a familia ja esta na versao $($principal.dados.versionName)."; return }
$feed = [ordered]@{}
foreach ($p in $teste.dados.PSObject.Properties) { if ($p.Name -ne 'aparelhos') { $feed[$p.Name] = $p.Value } }
$conteudo = ($feed | ConvertTo-Json -Depth 3)
Gravar $repo 'latest.json' $principal.sha $conteudo "Libera $($feed.versionName) para todos"
$reserva = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoApp/contents/docs/latest.json" -Headers $headers -Method Get
Gravar $repoApp 'docs/latest.json' $reserva.sha $conteudo "Libera $($feed.versionName) para todos"
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'docs\latest.json'), $conteudo, [Text.UTF8Encoding]::new($false))
Write-Output "LIBERADO: versao $($feed.versionName) para todos os aparelhos."
