# Anime legendado por MP4

A versão 2.13.70 acrescenta uma alternativa de anime sem alterar os caminhos de filmes, séries comuns, TV ao vivo ou anime dublado. A integração anterior do Meus Animes é consultada primeiro; quando ela não atende ao episódio, o resolvedor consulta o PROPLAYER LEG do Assistir Animes Online.

## Ausência de anúncios

O aplicativo não abre a página do fornecedor, não incorpora seu player e não executa seus scripts. O resolvedor lê apenas texto, rejeita sinais conhecidos de publicidade e extrai o arquivo MP4 para o player já existente no aplicativo. Não há alternativa automática por MyEmbed ou por páginas externas. Dattebayo, Goyabu e Hinata não foram adicionados.

Somente HTTPS e os hosts e caminhos previstos são aceitos. A mídia precisa corresponder ao caminho publicado pelo player e conter a assinatura pública de duração limitada. As URLs são renovadas a cada resolução e não são gravadas em fichas do aplicativo. O token do TMDB não é devolvido na resposta.

Uma falha de rede, publicidade detectada, idioma inesperado, formato incompatível ou episódio sem identidade confirmada retorna indisponibilidade. O aplicativo mantém suas demais alternativas existentes.

## Identidade e qualidade

O título precisa ser animação japonesa/coreana ou em japonês no TMDB. Temporada e episódio são validados no catálogo. A contagem absoluta usa as temporadas anteriores somente quando a temporada consultada usa números relativos. A página candidata só é aceita se publicar também o identificador TMDB e as coordenadas exatas do episódio esperado. Não há busca aproximada nem tentativa de outros títulos.

O resolvedor seleciona MP4 rotulado como 720p ou superior e prefere a maior qualidade informada. A interface mede a resolução real depois de decodificar o vídeo. O rótulo da fonte não é apresentado como medição.

O conector atende a opção **Legendado**, com legenda incorporada à imagem. A escolha **Dublado** mantém os fornecedores anteriores.

## Plataformas e validação

No Node, o conector é `anime-proplayer-source.js`, usado pela rota de anime existente. No Android, `ProplayerSource.java` faz as mesmas consultas pelo aparelho e a resposta passa pelo mesmo validador do player JavaScript. O APK mantém independência do computador e do servidor.

Há testes de isolamento, numeração absoluta, episódio incorreto, hosts e caminhos inválidos, publicidade, cancelamento, prazo e resolução mínima, além de testes de integração e compilação Java. Na verificação real inicial, Reincarnated as a Sword T2 E2 e T2 E3 resolveram como 1080p; T2 E3 reproduziu a 1920×1080 no player do aplicativo, com o iframe externo vazio.

A disponibilidade depende do catálogo e dos endereços publicados pelo fornecedor. Alterações de slug, identidade ou estrutura da página fazem a alternativa recusar o episódio, preservando as fontes existentes. Não se presume cobertura de todo o catálogo.
