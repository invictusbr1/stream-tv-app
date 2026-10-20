# Experiência discreta — primeira etapa, 2.13.104

O carregamento passa a mostrar somente um pequeno balde de pipoca com três grãos em movimento. O desenho é SVG incorporado; não carrega imagens, vídeos, bibliotecas ou serviços novos. A animação usa transformação e opacidade, fica pausada quando oculta e respeita a preferência de reduzir movimentos.

As mensagens normais continuam acessíveis a leitores de tela, mas ficam visualmente recolhidas. Progresso com percentual e avisos de erro continuam visíveis, com as ações existentes. O fechamento do carregamento continua sob responsabilidade do mesmo fluxo de reprodução.

Não há alteração no resolvedor de fontes, classificação de qualidade, idioma, orçamento de busca, recuperação, codec, certificados ou player nativo. A recuperação automática já implementada continua preservando o ponto e evitando trocar áudio dublado por original.

Validação: 532 testes do projeto passaram. Conferência visual com o HTML/CSS reais isolados em uma página local nos estados de carregamento, erro, pronto e progresso. Isso não equivale a um teste físico do APK no aparelho do usuário.

## Próximas etapas do projeto aprovado

1. Auditar recuperação e retomada em falhas de rede com cenários reproduzíveis antes de alterar o motor atual.
2. Conferir continuidade por série e sincronização entre dispositivos, preservando dados existentes.
3. Avaliar perfis individuais e controles contextuais sem aumentar a quantidade de informações na tela.
4. Simplificar o envio voluntário de diagnóstico, sem URLs assinadas ou credenciais.

Essas etapas ainda não estão implementadas nesta versão. Cada uma deve ter validação própria; não atribuir à animação mudanças de velocidade ou qualidade do vídeo.
