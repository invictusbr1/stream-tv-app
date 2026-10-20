# Entrega HTTPS no APK 2.13.101

O diagnóstico enviado pelo usuário na 2.13.100 confirmou HEVC habilitado, ClickHost com falha TLS e FenixHub escolhido em 1280×720. A investigação reproduziu o erro: parte dos redirecionamentos ClickHost anuncia HTTP; a promoção automática para HTTPS encontra um certificado autoassinado `XUI.one` em um intermediário. O destino final observado em Cloudflare Workers aceita HTTPS com certificado válido e entrega MP4.

## Mudança

Quando a medição nativa de um arquivo ClickHost falha no TLS, o APK solicita ao servidor a localização do destino final. A rota autenticada aceita um ID de catálogo e, opcionalmente, apenas a origem curta restrita do ClickHost. Ela lê redirecionamentos de uma lista de domínios permitidos, rejeita endereços privados, fixa a resolução DNS pública na conexão e limita prazo/saltos. HTTP intermediário é usado somente para localizar a entrega; o endereço retornado deve entregar MP4 por HTTPS válido.

O APK lê e mede esse endereço por HTTPS usando a validação normal do sistema. Só após a medição ele pode vencer a comparação. O vídeo é reproduzido diretamente do CDN; não passa pelo servidor do Conecta TV. Não foram habilitados tráfego claro no Android, certificados inválidos, validadores permissivos ou transcodificação. Os critérios de qualidade, português comprovado, ausência de anúncios, gavetas, cache e prazo total de seleção permanecem.

A recuperação é restrita ao ClickHost e à falha TLS: erro HTTP, codec recusado e outras fontes não acionam essa rota. O endereço efêmero não é gravado no histórico. O diagnóstico continua sem links e credenciais. Se não for possível confirmar a mídia superior dentro do prazo, as fontes válidas continuam disponíveis.

## Validação

- 522 testes passaram, incluindo recuperação TLS, rejeição de destinos arbitrários, HTTP/HTML, ciclos, formatos e títulos inválidos, isolamento dos demais fornecedores e reutilização do destino na segunda medição.
- Teste real com o transporte e seletor Java: Divertidamente 2 escolheu ClickHost 3840×1608, áudio português comprovado, em 4310 ms, acima da alternativa 720p.
- Toy Story 5: 3840×2160 português, em 2914 ms.
- Homem-Aranha: 3832×1600 português em 3106 ms numa repetição. O primeiro teste foi inconclusivo e recorreu ao 720p; não é evidência de disponibilidade permanente do fornecedor.
- O transporte Java também verificou o HTTPS do servidor. Os dois canais Android compilaram e passaram na análise e verificação de assinatura.
- Após a publicação, a rota HTTPS de produção respondeu 200 ao pedido autenticado. O seletor Java utilizou essa rota e escolheu Divertidamente 2 em 3840×1608 português em 5756 ms, acima do 720p. A mesma rota sem acesso respondeu 401. A publicação do servidor terminou saudável (`9cc7ad5abc20`).

O resultado no telefone do usuário ainda precisa ser confirmado após a instalação. O teste Java valida transporte, metadados e seleção; não substitui a decodificação e reprodução no Android físico.
