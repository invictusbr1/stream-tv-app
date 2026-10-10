param(
    [Parameter(Mandatory=$true)][string]$ToolRoot,
    [Parameter(Mandatory=$true)][string]$BuildDirectory,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$toolsPath = (Resolve-Path -LiteralPath $ToolRoot).Path
$buildPath = [IO.Path]::GetFullPath($BuildDirectory)
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if ($buildPath -match '[^\x00-\x7F]') { throw 'Use uma pasta de compilação sem acentos.' }
if ($buildPath -eq $PSScriptRoot -or $buildPath.Length -lt 10) { throw 'Use uma pasta separada para compilar.' }
& node (Join-Path $PSScriptRoot 'sync-ui.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar a interface.' }
# A versão da TV usa o mesmo conteúdo, mas com a marca do canal no config.json:
# é assim que o aplicativo da TV sabe procurar o APK próprio na atualização.
$assetsTv = Join-Path $PSScriptRoot 'app\src\tv\assets'
New-Item -ItemType Directory -Force -Path $assetsTv | Out-Null
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app\src\main\assets\config.json') -Raw | ConvertFrom-Json
$config | Add-Member -NotePropertyName canal -NotePropertyValue 'tv' -Force
($config | ConvertTo-Json -Compress) | Set-Content -LiteralPath (Join-Path $assetsTv 'config.json') -Encoding UTF8
& node --test (Join-Path $PSScriptRoot 'catalog.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes do catálogo.' }
New-Item -ItemType Directory -Force -Path $buildPath, $outputPath | Out-Null
foreach ($name in @('app','gradle','gradlew','gradlew.bat','settings.gradle','build.gradle','gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $buildPath -Recurse -Force
}
$env:JAVA_HOME = (Get-ChildItem -LiteralPath $toolsPath -Directory -Filter 'jdk-*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $toolsPath 'sdk'
$env:GRADLE_USER_HOME = Join-Path $toolsPath 'gradle-cache'
& (Join-Path $toolsPath 'gradle-8.11.1\bin\gradle.bat') -p $buildPath assembleCelularDebug assembleTvDebug lintCelularDebug lintTvDebug --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'Compilação ou verificação Android falhou.' }
$versionName = [regex]::Match((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app\build.gradle') -Raw), "versionName\s+'([^']+)'").Groups[1].Value
if (-not $versionName) { throw 'versionName não encontrado em app/build.gradle.' }
$saidas = @(
    @{ apk = Join-Path $buildPath 'app\build\outputs\apk\celular\debug\app-celular-debug.apk'; nome = "Conecta-TV-Android-$versionName.apk"; pacote = 'br.streamtv.app' },
    @{ apk = Join-Path $buildPath 'app\build\outputs\apk\tv\debug\app-tv-debug.apk'; nome = "Conecta-TV-TV-$versionName.apk"; pacote = 'br.streamtv.app.tv' }
)
foreach ($saida in $saidas) {
    if (-not (Test-Path -LiteralPath $saida.apk)) { throw "APK não encontrado: $($saida.apk)" }
    & (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\apksigner.bat') verify $saida.apk
    if ($LASTEXITCODE -ne 0) { throw "Assinatura inválida em $($saida.nome)." }
    $pacote = [regex]::Match((& (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt2.exe') dump badging $saida.apk | Select-Object -First 1), "name='([^']+)'").Groups[1].Value
    if ($pacote -ne $saida.pacote) { throw "Pacote inesperado em $($saida.nome): $pacote" }
    Copy-Item -LiteralPath $saida.apk -Destination (Join-Path $outputPath $saida.nome) -Force
    Write-Output "APK $($saida.nome) compilado, verificado e copiado ($pacote)."
}
