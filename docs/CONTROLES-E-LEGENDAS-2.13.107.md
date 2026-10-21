# Controles e legendas — 2.13.107

Os botões de qualidade, legendas, áudio e velocidade abriam seu menu e o mesmo clique chegava ao fechamento global. O fechamento agora reconhece os botões dentro das opções; tocar fora e Escape continuam fechando os menus.

A escolha explícita de desativar legendas permanece durante a reprodução, mesmo após novas listas de faixas. A seleção automática em português para áudio original continua disponível na abertura de outro vídeo. Desligar também alcança as cópias nativas das faixas HLS, sem alterar capítulos ou metadados usados pelos créditos. O indicador do botão acompanha a escolha atual.

Validação: 539 testes passaram, incluindo regressão do clique nos quatro botões, atualização de faixas após desativação, reinício da seleção automática no próximo vídeo e preservação de capítulos/metadados. A seleção de fornecedores e resolução não foi alterada. A reprodução do episódio específico no aparelho do usuário ainda depende de confirmação; legenda gravada na imagem não é uma faixa desativável.
