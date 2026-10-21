# Recuperação de fontes — 2.13.108

## Problema

No APK, uma candidata cuja medição retornava nulo ainda podia ser escolhida. O diagnóstico podia, portanto, informar uma fonte escolhida com falha de leitura. Cada nova tentativa também reiniciava a comparação dos fornecedores, somando prazos de consulta e de abertura do vídeo.

## Mudança

- Uma medição nula, incompatível ou temporariamente indisponível não aprova a candidata. Listas HLS válidas que ainda não declaram dimensões mantêm a compatibilidade anterior; continuam sem resolução comprovada.
- Alternativas medidas ficam em memória por 30 segundos, separadas por título/episódio e por motor de codec. Ao excluir uma fonte que falhou, a comparação recente é reutilizada, com nova medição paralela limitada a 2 segundos. Não usa candidatos excluídos ou fornecedores retirados da lista permitida. Se a nova leitura não confirmar alternativa, a busca normal continua.
- A ordenação por áudio e qualidade medida continua igual, incluindo 4K. O caminho da primeira busca e sua revisão de 8+4 segundos continuam disponíveis.
- A leitura redundante da mesma lista HLS após medição bem-sucedida foi retirada.
- Quando a busca nativa completa e o último recurso não encontram fonte, a interface recebe essa informação e não repete a mesma rodada imediatamente. Falhas transitórias de consulta sem essa confirmação continuam permitindo a repetição anterior. O último recurso original possui prazo de 5 segundos.
- O diagnóstico registra fontes que falharam na reprodução e informa “Nenhuma validada” quando não há escolha.

## Validação

543 testes passaram. Casos novos cobrem retorno nulo/exceção de leitura, recuperação pela alternativa de maior qualidade, nova leitura da reserva, isolamento de episódios, exclusões, remoção de fornecedores e continuidade da busca se as reservas falharem. Os testes existentes de 4K, HEVC, português, segurança e controles passaram. APKs celular/TV compilados, com verificações Android e assinatura.

Comparação ao vivo do seletor Java com descoberta pelos adaptadores do backend, Tulsa King T3E3: a primeira busca mediu MGEB em 1280×720, português, em 12,02s nos dois caminhos. Na segunda rodada, a versão anterior escolheu FenixHub sem medição em 12,02s; a nova escolheu FenixHub medido em 1280×720, idioma não informado, em 11,13s. A terceira opção WatchPlay entregou uma lista válida sem dimensões declaradas. A amostra não continha outra reserva medida utilizável na primeira rodada, portanto não demonstrou aceleração pela reserva nesse caso. Os testes controlados verificam o caminho rápido sem repetir a consulta ao fornecedor.

A comparação ao vivo mede seleção/leitura Java, não decodificação no aparelho Samsung do usuário nem o tempo integral até imagem. A instabilidade do fornecedor e a interrupção anteriormente registrada em 779,93s ainda não têm causa técnica específica confirmada; esta versão não afirma resolver todos os bloqueios de mídia.
