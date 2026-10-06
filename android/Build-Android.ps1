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
& node --test (Join-Path $PSScriptRoot 'catalog.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes do catálogo.' }
New-Item -ItemType Directory -Force -Path $buildPath, $outputPath | Out-Null
foreach ($name in @('app','gradle','gradlew','gradlew.bat','settings.gradle','build.gradle','gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $buildPath -Recurse -Force
}
$env:JAVA_HOME = (Get-ChildItem -LiteralPath $toolsPath -Directory -Filter 'jdk-*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $toolsPath 'sdk'
$env:GRADLE_USER_HOME = Join-Path $toolsPath 'gradle-cache'
& (Join-Path $toolsPath 'gradle-8.11.1\bin\gradle.bat') -p $buildPath assembleDebug lintDebug --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'Compilação ou verificação Android falhou.' }
$apk = Join-Path $buildPath 'app\build\outputs\apk\debug\app-debug.apk'
& (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\apksigner.bat') verify $apk
if ($LASTEXITCODE -ne 0) { throw 'Assinatura inválida.' }
$versionName = [regex]::Match((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app\build.gradle') -Raw), "versionName\s+'([^']+)'").Groups[1].Value
if (-not $versionName) { throw 'versionName não encontrado em app/build.gradle.' }
Copy-Item -LiteralPath $apk -Destination (Join-Path $outputPath "Stream-TV-Android-$versionName.apk") -Force
Write-Output 'APK de teste compilado, verificado e copiado.'
