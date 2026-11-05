# Descobre por que o PC nao enxerga a TV Samsung no modo desenvolvedor.
param([string]$IpDaTv = '')
$ErrorActionPreference = 'Continue'
Write-Host ''
Write-Host '  Diagnostico da instalacao na TV Samsung' -ForegroundColor Cyan
Write-Host '  ---------------------------------------' -ForegroundColor Cyan
if ($IpDaTv) { $tv = $IpDaTv } else { $tv = Read-Host '  Digite o IP da TV (TV: Configuracoes > Geral > Rede > Status da rede > Config. de IP)' }
$tv = $tv.Trim()
Write-Host ''
Write-Host '[1] IPs deste PC (este e o numero que vai no Developer Mode da TV):' -ForegroundColor Yellow
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object InterfaceAlias, IPAddress
$ips | ForEach-Object { Write-Host ("     {0,-28} {1}" -f $_.InterfaceAlias, $_.IPAddress) }
$mesmaRede = $ips | Where-Object { ($_.IPAddress -split '\.')[0..2] -join '.' -eq (($tv -split '\.')[0..2] -join '.') }
if ($mesmaRede) { Write-Host "     OK: o PC esta na mesma faixa da TV ($($mesmaRede[0].IPAddress))." -ForegroundColor Green }
else { Write-Host '     PROBLEMA: nenhum IP do PC esta na mesma faixa da TV. PC e TV estao em redes diferentes (rede de visitante, repetidor/mesh ou 2,4 x 5 GHz separados).' -ForegroundColor Red }
Write-Host ''
Write-Host '[2] VPN ligada?' -ForegroundColor Yellow
$vpn = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'VPN|TAP|WireGuard|Tailscale|ZeroTier|Hamachi|Radmin|OpenVPN' }
if ($vpn) { Write-Host "     ATENCAO: desligue: $($vpn.Name -join ', ')" -ForegroundColor Red } else { Write-Host '     OK: nenhuma VPN ativa.' -ForegroundColor Green }
Write-Host ''
Write-Host '[3] Perfil da rede do Windows (precisa ser Privada):' -ForegroundColor Yellow
Get-NetConnectionProfile | ForEach-Object {
  if ($_.NetworkCategory -eq 'Public') { Write-Host "     PROBLEMA: '$($_.Name)' esta como PUBLICA. Para corrigir, rode como administrador: Set-NetConnectionProfile -InterfaceIndex $($_.InterfaceIndex) -NetworkCategory Private" -ForegroundColor Red }
  else { Write-Host "     OK: '$($_.Name)' esta como $($_.NetworkCategory)." -ForegroundColor Green } }
Write-Host ''
Write-Host '[4] O PC alcanca a TV?' -ForegroundColor Yellow
if (Test-Connection -ComputerName $tv -Count 2 -Quiet) { Write-Host '     OK: a TV responde ao ping.' -ForegroundColor Green }
else { Write-Host '     PROBLEMA: a TV nao responde. Confira o IP e se o roteador isola aparelhos (isolamento de cliente/AP isolation).' -ForegroundColor Red }
Write-Host ''
Write-Host '[5] Porta do modo desenvolvedor (26101):' -ForegroundColor Yellow
$porta = Test-NetConnection -ComputerName $tv -Port 26101 -WarningAction SilentlyContinue
if ($porta.TcpTestSucceeded) { Write-Host '     OK: a porta 26101 esta aberta - o modo desenvolvedor esta ligado.' -ForegroundColor Green }
else { Write-Host '     PROBLEMA: porta 26101 fechada. Na TV: Apps > digite 12345 > Developer mode ON > IP do PC (item 1) > OK, e DESLIGUE a TV da tomada por 30 s (reiniciar pelo controle nao basta).' -ForegroundColor Red }
Write-Host ''
Write-Host '[6] Ferramenta sdb (Tizen Studio):' -ForegroundColor Yellow
$sdb = @("$env:USERPROFILE\tizen-studio\tools\sdb.exe", 'C:\tizen-studio\tools\sdb.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($sdb) {
  Write-Host "     encontrado: $sdb" -ForegroundColor Green
  & $sdb disconnect | Out-Null
  & $sdb connect "$($tv):26101"
  & $sdb devices
} else { Write-Host '     Tizen Studio nao encontrado nas pastas padrao.' -ForegroundColor DarkYellow }
Write-Host ''
Write-Host '  Mande uma foto ou copie este resultado para o chat.' -ForegroundColor Cyan
