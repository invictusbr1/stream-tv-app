# Recuperação de rede do APK — 2.13.113

## Evidência e limite do diagnóstico

No S25 FE, os registros do APK 2.13.110–112 mostram falha na consulta a múltiplos fornecedores, com prazo_consulta em 12 segundos, antes de qualquer imagem. No navegador há reproduções de Quem Ama Cuida T1E134/135 em 720p pelo MGEB. O usuário confirmou que o navegador funciona no mesmo S25 FE e que a comparação com o S26 usava redes diferentes. Isso aponta à diferença entre conexão direta do APK e descoberta/transporte pelo servidor. Não comprova defeito de codec, nem permite atribuir a causa exata a DNS, IPv6, TLS ou operadora sem medição no aparelho.

## Recuperação

Quando o seletor local não encontra uma fonte, o APK consulta o mesmo backend utilizado pelo navegador, autenticado pelo código de acesso, mantendo o codec permitido, exclusões e prioridade de qualidade/dublagem. O backend encaminha mídia também quando o fornecedor normalmente entrega arquivo final direto. Se funcionar, esse caminho é reutilizado por três minutos, evitando repetir consultas diretas sem resposta a cada título. Se a consulta remota falhar, a busca local volta a ser tentada. O S26 que encontra mídia diretamente mantém esse caminho.

A mídia remota chega ao mesmo player local por uma rota interna autenticada: listas HLS são reescritas para caminhos do servidor; arquivos/segmentos são transmitidos por fluxo e preservam Range/Content-Range, sem acumular filmes inteiros em memória. A credencial só vai em cabeçalho para a origem HTTPS validada, sem redirecionamento e sem código em URLs. Apenas rotas de mídia conhecidas são aceitas. HTML e mídia fora da origem são recusados. O diagnóstico distingue Conexão: servidor. Conversões ainda em preparação não são abertas por esse caminho.

## Verificação

552 testes passaram, incluindo origem/autenticação, isolamento de credenciais, redirecionamentos recusados, HLS/chaves/segmentos, HTML recusado, Range, transmissão sem leitura prévia do arquivo e reprodução da rota no player com seleção 4K preservada. O teste no S25 FE real ainda depende da instalação e confirmação do usuário. Não há promessa de tempo fixo de abertura ou de disponibilidade de todos os títulos.

## Verificação após publicação do servidor

O usuário confirmou que o mesmo APK no S25 FE reproduz usando dados móveis e falha no Wi-Fi; a causa específica da rede ainda não foi medida. Com o servidor publicado, o mesmo transporte Java do APK recebeu JSON e mídia dublada de Quem Ama Cuida T1E134 (MGEB/HLS), Moana (MGEB/HLS) e Doutor Estranho no Multiverso da Loucura (ClickHost/MP4). HLS foi seguido até segmento e MP4 respondeu 206 a Range de 1.024 bytes. Na primeira rodada houve um timeout de consulta da série e falha em uma variante HLS de Doutor Estranho; a rodada seguinte abriu os três. São verificações de entrega inicial, não reprodução completa nem teste físico na rede afetada.
