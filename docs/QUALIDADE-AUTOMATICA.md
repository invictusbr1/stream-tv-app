# Escolha de qualidade no navegador

O avaliador de filmes e episódios compara todas as fontes aprovadas aplicáveis ao título, respeitando as exclusões de fontes que falharam. Os prazos por consulta continuam limitados. Uma posição depois da quinta fonte não elimina uma opção da comparação.

A ordem é: idioma comprovado, resolução medida, reprodução sem conversão, taxa e tempo de resposta. Fontes com português confirmado pela central ou pelas faixas participam do mesmo grupo; dentro dele a resolução prevalece sobre velocidade e a pontuação complementar. Um idioma contradito perde prioridade. Rótulos do fornecedor continuam identificados como informação, sem virar medição.

A medição considera largura e altura, preservando o formato de cinema. Uma imagem 1920×800 não perde para 1280×720 por causa do recorte. Arquivos que precisam converter áudio também têm suas faixas e imagem consultadas; o caminho de conversão existente permanece responsável por reproduzi-los.

Listas HLS sem resolução declarada podem medir um segmento claro da mesma origem. Não há consulta adicional de chaves, segmentos com credenciais ou segmentos em outro domínio por esse caminho. Quando a medição não é possível, não é inventada uma resolução.

Leituras simultâneas da mesma mídia compartilham a sondagem. Medições concluídas são guardadas por endereço e referenciador exatos: até dez minutos para arquivos e um minuto para listas. A próxima abertura pode aproveitar uma medição concluída depois do prazo inicial, sem ficar presa à opção de reserva. O cache de escolhas tem limite de 256 entradas e a memória de medições tem limite de 128. Limpar o cache impede que uma sondagem antiga o preencha novamente.

As mudanças se aplicam ao resolvedor Node do projeto e do servidor. O APK mantém seu resolvedor próprio e não foi alterado nesta revisão. Não foram adicionados fornecedores nem páginas externas. A disponibilidade e a qualidade final continuam dependendo dos vídeos que cada fornecedor entrega naquele momento.
