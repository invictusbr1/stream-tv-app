# Instala o player do PC (mpv) para o Conecta TV tocar 4K/HEVC, MKV e Dolby.
# 1o jeito: winget (loja de programas do proprio Windows), pacote shinchiro.mpv.
# 2o jeito: versao oficial do GitHub + extrator oficial do 7-Zip, em
#           %LOCALAPPDATA%\ConectaTV\mpv.
# No fim grava onde o mpv.exe ficou em %LOCALAPPDATA%\ConectaTV\mpv-caminho.txt.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }
$base = Join-Path $env:LOCALAPPDATA 'ConectaTV'
$destino = Join-Path $base 'mpv'
$arqCaminho = Join-Path $base 'mpv-caminho.txt'
New-Item -ItemType Directory -Force -Path $base | Out-Null

function Guardar($exe) {
    Set-Content -LiteralPath $arqCaminho -Value $exe -Encoding UTF8
    $conf = Join-Path $base 'mpv-config'
    New-Item -ItemType Directory -Force -Path $conf | Out-Null
    Set-Content -LiteralPath (Join-Path $conf 'mpv.conf') -Encoding ASCII -Value @('sub-font-size=46', 'sub-border-size=3', 'osd-font-size=40', 'save-position-on-quit=no', 'volume-max=150')
    Set-Content -LiteralPath (Join-Path $conf 'input.conf') -Encoding ASCII -Value @('ESC quit', 'BS quit', 'ENTER cycle pause', 'f cycle fullscreen', 'MBTN_LEFT_DBL cycle fullscreen')
    Write-Output "INSTALADO $exe"
}

function AcharMpv {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $c = Get-Command mpv.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\mpv.exe', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\mpv.exe')) {
        try { $v = (Get-ItemProperty -LiteralPath $k -ErrorAction Stop).'(default)'; if ($v -and (Test-Path -LiteralPath $v)) { return $v } } catch {}
    }
    $raizes = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'), (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'), $destino) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($r in $raizes) {
        $achado = Get-ChildItem -LiteralPath $r -Filter mpv.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($achado) { return $achado.FullName }
    }
    return $null
}

$ja = AcharMpv
if ($ja) { Guardar $ja; exit 0 }

# --- 1o jeito: winget ---
$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
if ($winget) {
    Write-Output 'PASSO instalando pelo Windows (winget)'
    try {
        & $winget.Source install --id shinchiro.mpv --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | ForEach-Object { if ("$_".Trim()) { Write-Output "WINGET $_" } }
    } catch { Write-Output "AVISO winget: $($_.Exception.Message)" }
    $exe = AcharMpv
    if ($exe) { Guardar $exe; exit 0 }
    Write-Output 'AVISO o winget nao instalou; tentando pelo GitHub'
} else { Write-Output 'AVISO winget nao existe neste Windows; tentando pelo GitHub' }

# --- 2o jeito: GitHub + 7-Zip ---
$tmp = Join-Path $env:TEMP 'conectatv-mpv'
New-Item -ItemType Directory -Force -Path $tmp, $destino | Out-Null
$curl = Join-Path $env:WINDIR 'System32\curl.exe'
function Baixar($url, $saida) {
    Remove-Item -LiteralPath $saida -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $curl) {
        $msg = & $curl -fsSL --retry 3 --connect-timeout 20 -A 'Mozilla/5.0 ConectaTV-PC' -o $saida $url 2>&1
        if ($LASTEXITCODE -eq 0) { return }
        Write-Output "AVISO curl ($url): $msg"
    }
    try { Invoke-WebRequest -Uri $url -OutFile $saida -UseBasicParsing -UserAgent 'Mozilla/5.0 ConectaTV-PC' }
    catch { throw "nao baixou $url ($($_.Exception.Message))" }
}
try {
    $arquivo = $null
    foreach ($repo in @('shinchiro/mpv-winbuild-cmake', 'zhongfly/mpv-winbuild')) {
        try {
            Write-Output "PASSO procurando a versao mais nova ($repo)"
            $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'ConectaTV-PC' }
            $arquivo = $rel.assets | Where-Object { $_.name -match '^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$' } | Select-Object -First 1
            if ($arquivo) { break }
        } catch { Write-Output "AVISO $repo indisponivel: $($_.Exception.Message)" }
    }
    if (-not $arquivo) { throw 'nao achei o player no GitHub' }
    Write-Output 'PASSO baixando o extrator (7-Zip)'
    Baixar 'https://www.7-zip.org/a/7zr.exe' (Join-Path $tmp '7zr.exe')
    Write-Output "TAMANHO $($arquivo.size)"
    Write-Output "PASSO baixando o player ($([math]::Round($arquivo.size / 1MB)) MB)"
    Baixar $arquivo.browser_download_url (Join-Path $tmp 'mpv.7z')
    Write-Output 'PASSO extraindo'
    & (Join-Path $tmp '7zr.exe') x (Join-Path $tmp 'mpv.7z') "-o$destino" -y | Out-Null
    Remove-Item -LiteralPath (Join-Path $tmp 'mpv.7z') -Force -ErrorAction SilentlyContinue
    $exe = Join-Path $destino 'mpv.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'a extracao nao gerou o mpv.exe' }
    Guardar $exe
    exit 0
} catch {
    Write-Output "ERRO $($_.Exception.Message)"
    exit 2
}
