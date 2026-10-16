param([string]$Saida='')
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'diagnostico'
if(!$Saida){$Saida=Join-Path $PSScriptRoot '../dist'}
$dest=[IO.Path]::GetFullPath($Saida)
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach($name in @('config.xml','index.html','app.js','core.js','style.css','icon.png','controle.mp4')){if(!(Test-Path -LiteralPath (Join-Path $source $name))){throw "Arquivo ausente: $name"}}
$out=Join-Path $dest 'Conecta-TV-Samsung-Teste-0.1.0-nao-assinado.wgt'
if(Test-Path -LiteralPath $out){throw "Pacote já existe: $out. Escolha outra pasta para preservar a versão anterior."}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($source,$out)
Write-Output "Pacote de diagnóstico NÃO ASSINADO: $out. Assine no Tizen Studio antes de instalar."
