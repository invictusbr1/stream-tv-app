# Próximo episódio no início dos créditos — 2.13.103

Antes, a contagem só recebia o evento `ended`, obrigando esperar até o último segundo do arquivo. Agora o player pode iniciar a mesma contagem de cinco segundos no início marcado dos créditos finais.

## Ponto de início

Prioridade: marcação manual do usuário para aquele episódio/mídia, capítulo explicitamente identificado como créditos finais e, se habilitada pelo usuário, antecipação aproximada de 90 segundos. Sem qualquer uma dessas condições, mantém o término real como reserva. Não há percentual fixo de reprodução, análise de pixels, OCR ou consulta de vídeo adicional.

Nem toda fonte entrega marcações. Capítulos genéricos, legendas, abertura, capítulos ambíguos e tempos fora da parte final não são tratados como créditos. As marcações manuais ficam no aparelho por episódio, fornecedor, idioma, identidade da mídia e duração; o armazenamento é limitado e não contém endereço nem token. A aproximação é uma preferência por aparelho e vem desligada: não deve ser descrita como identificação real dos créditos.

Em **Opções → Créditos deste episódio**, é possível marcar o ponto atual, informar o tempo, remover a marcação ou escolher **Sem marcação → Antecipar 90 segundos**. Este último caso pode incluir cenas finais. O painel permanece recolhido e usa os controles existentes.

## Controle e progresso

- Mantém Assistir agora e Cancelar. Cancelar permite assistir aos créditos e evita outra contagem automática ao chegar no término real.
- Pausar, abrir opções, ir ao segundo plano ou entrar na apresentação nativa suspende a contagem; o retorno oferece cinco segundos completos.
- Voltar a uma cena anterior aos créditos interrompe a contagem. Trocar título/fonte ou fechar o player remove os eventos do vídeo antigo.
- Buffering/novo evento playing não cancela uma contagem válida. O evento ended não reinicia uma contagem já ativa.
- Entrar nos créditos não enfileira o próximo episódio como progresso antes da decisão. A navegação continua usando o catálogo e preserva idioma/anime.

## Validação

532 testes passaram, incluindo marcação anterior ao fim real, ausência/ambiguidade de capítulo, isolamento das marcações, opção aproximada, falha de armazenamento, pausa, opções, cancelamento e troca de episódio. A prévia funcional usou um episódio de teste com arquivo de 40 minutos e marcador em 37:30: a contagem apareceu nesse ponto, com ended falso, e navegou para T1 E2 após cinco segundos. A opção de 90 segundos também foi conferida pela interface.

Esse teste não comprova que fornecedores reais exponham capítulos de créditos. O módulo depende de um vídeo controlado pelo aplicativo; não lê o estado interno de iframes de terceiros. Não altera qualidade, dublagem, recuperação HTTPS ou seleção de fornecedor.
