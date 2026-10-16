# Conecta TV - servidor principal (sobe junto com o Windows)
#
# Por que este arquivo existe: antes o servidor era aberto solto pelo
# Manter-Online.ps1, preso a quem o iniciou. Se aquela janela morresse, o
# aplicativo morria junto e o pessoal via "offline". Aqui ele sobe pelo atalho
# da pasta de Inicializacao, se reabre sozinho se cair e nao depende de ninguem.
#
# NAO abre navegador de proposito: este processo e o servidor, nao o atalho.
#
# IMPORTANTE: este arquivo PRECISA ficar salvo em UTF-8 COM BOM. O Windows
# PowerShell 5.1 le arquivo sem BOM como ANSI e o acento de "Area" quebra o
# caminho. Se editar, salve de novo com BOM.

$pasta = 'C:\Users\tikto\OneDrive\Área de Trabalho\stream tv'
$log   = Join-Path $pasta 'servidor-tarefa.log'

# Dados do aplicativo (aparelhos autorizados, legendas, acessos).
# Aponta para a pasta do programa instalado, para nao perder autorizacao
# nem as legendas ja baixadas.
$env:DADOS_DIR     = 'C:\Users\tikto\Conecta TV'
$env:ACESSO_CODIGO = 'conecta-2007'
$env:PORT          = '3000'

function Registrar($texto) {
    $linha = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
    try { Add-Content -LiteralPath $log -Value $linha -Encoding UTF8 } catch { }
    Write-Host $linha
}

Registrar 'Servidor iniciando.'

Set-Location -LiteralPath $pasta

# Se ja houver alguem atendendo na porta, nao sobe um segundo.
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { Registrar 'Ja havia um servidor no ar na porta 3000 - encerrando sem subir outro.'; exit 0 }
} catch { }

# Fica de guarda: se o servidor terminar sozinho, sobe de novo. Isso e o que o
# Manter-Online fazia por fora; aqui e o proprio processo que se cuida.
$volta = 0
while ($true) {
    & 'C:\Program Files\nodejs\node.exe' (Join-Path $pasta 'server.js')
    $codigo = $LASTEXITCODE
    if ($codigo -eq 0) { Registrar 'Servidor encerrado de forma limpa (codigo 0). Nao vou reabrir.'; break }
    $volta++
    Registrar "Servidor caiu (codigo $codigo). Tentativa $volta de reabrir em 10 segundos."
    Start-Sleep -Seconds 10
}
