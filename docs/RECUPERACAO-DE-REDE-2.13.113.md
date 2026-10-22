# Recuperação de rede do APK — 2.13.113

## Evidência e limite do diagnóstico

No S25 FE, os registros do APK 2.13.110–112 mostram falha na consulta a múltiplos fornecedores, com prazo_consulta em 12 segundos, antes de qualquer imagem. No navegador há reproduções de Quem Ama Cuida T1E134/135 em 720p pelo MGEB. O usuário confirmou que o navegador funciona no mesmo S25 FE e que a comparação com o S26 usava redes diferentes. Isso aponta à diferença entre conexão direta do APK e descoberta/transporte pelo servidor. Não comprova defeito de codec, nem permite atribuir a causa exata a DNS, IPv6, TLS ou operadora sem medição no aparelho.

## Recuperação

Quando o seletor local não encontra uma fonte, o APK consulta o mesmo backend utilizado pelo navegador, autenticado pelo código de acesso, mantendo o codec permitido, exclusões e prioridade de qualidade/dublagem. O backend encaminha mídia também quando o fornecedor normalmente entrega arquivo final direto. Se funcionar, esse caminho é reutilizado por três minutos, evitando repetir consultas diretas sem resposta a cada título. Se a consulta remota falhar, a busca local volta a ser tentada. O S26 que encontra mídia diretamente mantém esse caminho.

A mídia remota chega ao mesmo player local por uma rota interna autenticada: listas HLS são reescritas para caminhos do servidor; arquivos/segmentos são transmitidos por fluxo e preservam Range/Content-Range, sem acumular filmes inteiros em memória. A credencial só vai em cabeçalho para a origem HTTPS validada, sem redirecionamento e sem código em URLs. Apenas rotas de mídia conhecidas são aceitas. HTML e mídia fora da origem são recusados. O diagnóstico distingue Conexão: servidor. Conversões ainda em preparação não são abertas por esse caminho.

## Verificação

552 testes passaram, incluindo origem/autenticação, isolamento de credenciais, redirecionamentos recusados, HLS/chaves/segmentos, HTML recusado, Range, transmissão sem leitura prévia do arquivo e reprodução da rota no player com seleção 4K preservada. O teste no S25 FE real ainda depende da instalação e confirmação do usuário. Não há promessa de tempo fixo de abertura ou de disponibilidade de todos os títulos.
