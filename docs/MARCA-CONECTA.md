# Marca Conecta TV — 2.13.102

Identidade aprovada pelo usuário: C vermelho em forma de fita, com curvas e sobreposição, fundo quase preto e nome CONECTA TV em branco e vermelho.

A geometria é compartilhada por `android/brand-assets.cjs`, que gera o SVG do cabeçalho, vetores Android e PNGs do aplicativo web. O SVG tem cerca de 1,6 KB. Não há fonte externa, biblioteca ou animação nova no aplicativo.

- Android 23: vetor com cores sólidas; Android 24+: gradientes nativos; Android 26+: ícone adaptativo com margem para as máscaras do sistema. O pacote e o nome do aplicativo permanecem.
- Web, APK e TV: cabeçalho reutiliza o SVG com nome acessível no botão; símbolo decorativo não duplica a leitura. Há regra compacta para celular.
- PWA: ícones 180, 192 e 512 pixels; o maior preserva a área segura da máscara. O cache da interface foi versionado e inclui a nova marca para uso offline.
- TV: o banner mantém proporção 16:9 com o mesmo símbolo.

Para regenerar, executar `node android/brand-assets.cjs` com o pacote Sharp disponível no ambiente de desenvolvimento. A compilação normal usa os arquivos prontos, sem depender dessa ferramenta.

Validação: conferência visual do ícone e do cabeçalho em largura de celular, 15 testes de episódios/PWA/arquivos públicos e compilação/análise dos dois canais Android. A contagem automática de próximo episódio permaneceu intacta: cinco segundos após o fim real do vídeo, desde que exista um episódio seguinte disponível no catálogo, com assistir agora e cancelar. Os 11 testes específicos dessa navegação passaram.

Esta versão altera a identidade visual e a entrega do SVG, sem modificar o resolvedor, a medição de resolução, a recuperação HTTPS do ClickHost ou as preferências de reprodução.
