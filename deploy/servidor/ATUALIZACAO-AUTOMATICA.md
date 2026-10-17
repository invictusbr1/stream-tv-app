# Atualização automática da Oracle

O monitor desta pasta publica a versão web e os serviços da Oracle depois de dois minutos sem alterações nos arquivos de execução. O computador precisa estar ligado e com o usuário conectado para enviar mudanças. O site hospedado continua funcionando com este computador desligado.

O monitor é iniciado pela tarefa do Windows **Connecta TV - Atualizacao Oracle**. Seu estado, registros e chave privada ficam em `%USERPROFILE%\Documents\ConnectaTV\Oracle`, fora do projeto e do pacote enviado. Não há necessidade de publicar no GitHub.

Antes de enviar, ele prepara uma cópia consistente, verifica sintaxe JavaScript e arquivos JSON e exclui configurações privadas, chaves e dados locais. O servidor constrói uma versão por vez, guarda as imagens e o código anteriores e preserva os mesmos volumes e o mesmo arquivo de senhas. Após iniciar, verifica aplicativo, Central, interface e arquivos do player. Se a troca falhar, tenta restaurar a versão anterior.

Uma publicação pode causar um breve reinício dos serviços. Isso não recompila nem distribui APKs Android ou aplicativos de TV.

Desde 2.13.81, o publicador registra avisos no volume persistente do aplicativo: preparação, reinício em cerca de 45 segundos e conclusão (ou recuperação/adiamento em caso de falha). Antes de trocar os contêineres, aguarda 45 segundos para os aparelhos consultarem o aviso. O sino na interface guarda os últimos 20 avisos; cada etapa aparece uma única vez por aparelho, sem interromper o vídeo. A consulta ocorre a cada 20 segundos enquanto a tela está visível. A API pública `/api/notificacoes` é apenas de leitura e contém somente mensagens fixas de manutenção, sem dados pessoais ou credenciais. Não há permissão de notificações do sistema nem mensagens fora do aplicativo. Clientes anteriores precisam atualizar/reabrir a interface; APKs precisam da versão 2.13.81 ou posterior. A primeira instalação desse recurso habilita os avisos para as próximas publicações.

Para pausar durante uma edição grande, crie o arquivo `.oracle-atualizacao-pausada` na raiz do projeto. Apague somente esse arquivo quando quiser retomar. Se uma versão falhar, ela só será tentada novamente após outra alteração nos arquivos; os detalhes ficam no registro do monitor.

O programa aceita `--watch` para monitorar, `--once` para publicar imediatamente e `--status` para consultar o estado. A configuração de destino fica em `config.json` no diretório de estado indicado acima.

A instalação foi ativada neste computador em 14/10/2026. Há três cópias recentes do código no servidor para recuperação; elas não substituem uma cópia de segurança dos dados persistentes.
