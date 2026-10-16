# Qualidade no Android — 2.13.71

O APK de celular e o de Android TV passam a comparar as fontes de filmes e episódios antes de escolher. As consultas são feitas pelo próprio aparelho, sem computador ou servidor obrigatório. As fichas aprovadas que servem ao título também participam, cada uma com seu identificador; uma falha excluída pelo player não reaparece na recuperação.

O seletor prioriza português comprovado pelos metadados, depois resolução medida, taxa e desempate estável. Largura e altura são consideradas juntas para filmes em formato de cinema. A primeira resposta em HD não encerra a comparação se há outra opção disponível em Full HD. Rótulos são mantidos como informação quando não há medição; a interface continua exibindo a resolução real decodificada pelo vídeo.

Listas HLS são lidas como texto, respeitando a preferência AVC já usada pelo player Android. Para arquivos MP4 e segmentos claros da mesma origem, o leitor de mídia do Android consulta faixas pequenas por HTTP Range. A leitura tem limite de dois MiB, quarenta pedidos e prazo próprio. HTML, JSON, faixas incompatíveis e alterações de tamanho durante a leitura são rejeitados. Metadados que indiquem idioma incompatível ou ausência de decodificador de vídeo impedem a promoção daquela candidata.

A comparação tem prazo de doze segundos e seis trabalhadores limitados. Uma comparação incompleta não congela a reserva HD em memória. A memória separa título, temporada, episódio, exclusões e versão das fichas; uma URL que deixa de entregar vídeo invalida a escolha. Nenhuma página ou script do fornecedor é aberto para o usuário. Os conectores próprios de anime legendado e TV ao vivo permanecem em suas rotas.

Testes Java exercitam a comparação de sete fornecedores, resposta HD rápida contra Full HD posterior, formato de cinema, áudio incompatível, recuperação e cache, prazo, preferência AVC e limites de leitura. Os dois APKs passam pela compilação, lint e verificação de assinatura e pacote. A validação em aparelho físico depende de um dispositivo conectado; não deve ser presumida a partir desses testes.
