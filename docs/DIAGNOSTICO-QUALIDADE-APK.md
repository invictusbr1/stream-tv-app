# Diagnóstico de seleção no APK 2.13.100

O usuário confirmou a versão 2.13.99 instalada e Divertidamente 2 ainda em 720p/1080p. A central não recebeu essa nova reprodução; o registro anterior 2.13.97 não permite concluir qual fonte foi descartada no teste atual. Os testes do servidor que obtiveram ClickHost 3840×1608 não comprovam o resultado do celular.

Esta versão acrescenta observação ao resolvedor nativo, sem mudar classificação, critérios de aprovação, prazos, cache, codecs aceitos ou preferência de idioma. Nas opções do player, a seção recolhida **Verificação de qualidade** mostra o motor utilizado, fonte escolhida e resultado das verificações por fornecedor. **Copiar diagnóstico** permite obter o texto mesmo sem envio à central.

Os motivos são códigos fixos: conexão segura, DNS, prazo, HTTP, formato de vídeo/áudio, metadados e idioma. Não incluem endereço de mídia, token nem mensagem livre de exceção. O histórico em memória é limitado; a interface valida e limita os campos novamente. Um evento opcional `qualidade`, com `ok:true`, reutiliza o envio já existente, sem penalizar fornecedores ou bloquear a reprodução. O painel ignora respostas de outro título/episódio.

Validação: 26 testes específicos passaram, incluindo seleção, recuperação, segurança dos campos, cópia defensiva do histórico, episódio antigo e indisponibilidade da central. A compilação e análise Android verificam os dois canais antes da publicação. O resultado de reprodução no celular continua pendente; esta versão não deve ser apresentada como correção comprovada de 4K.

Próximo teste: abrir Divertidamente 2 no APK atualizado, aguardar a reprodução e consultar **Opções → Verificação de qualidade**. O motivo apresentado pelo ClickHost determinará a correção necessária. Não presumir limitação do aparelho nem alterar a resolução anunciada para simular 4K.
