# Conecta TV — estado e pendências (ler antes de qualquer tarefa)

> Este arquivo é a memória do projeto. Abrir SEMPRE no começo de uma tarefa e
> atualizar no fim. Assim nada precisa ser repetido pelo usuário.

## Última versão publicada

### Meus Animes — investigação de 12/10/2026 (sem ativação/publicação)

- Usuário indicou https://meusanimes.blog/e/one-piece-1-episodio-1/. Página HTTP 200; player público em serv01.meusdoramas.club consulta /posts/get-video.php, abre Blogger e entrega MP4 temporário Googlevideo.
- Confirmados em Chromium real: One Piece T1 E1 em 1280x720 com avanço, duração indicada 24min15s; Solo Leveling T2 E1 em 1280x720, duração 23min40s, avanço aos 180s e legenda portuguesa visível. Testes curtos; não confirmados episódios inteiros, dublado, legenda de One Piece ou aparelhos físicos.
- Usado o espião do caçador nas duas obras: detectou API/Blogger, mas nenhum vídeo por suas limitações de extensão/clique no iframe. O teste direto pelo caçador não reproduziu One Piece; Range/Referer em consulta HTTP adicional retornou 403. Classificação: promissor/em análise; compatibilidade interna ainda não aprovada.
- Catálogo One Piece em /a/one-piece/ mostra 1–110 e depois 1037+, com lacuna visível111–1036. Usa temporada1+número absoluto. Solo Leveling separa temporadas: T1E1–12 e T2E1–13; amostra https://meusanimes.blog/e/solo-leveling-2-episodio-1/. Não presumir catálogo completo nem somar temporadas TMDB automaticamente: números podem já ser globais.
- Integração depende de adaptador de título/episódio/player e contexto Blogger/Googlevideo, URLs temporárias renováveis, suporte no computador/Android e aprovação com prova de legenda portuguesa. Não alterar assinatura/parâmetros do fornecedor nem salvar URL temporária como receita permanente.
- Sem alterações funcionais, ativação de fornecedor ou publicação. Versão continua 2.13.68/398. Relatório/evidências: C:/Users/tikto/Documents/Codex/2026-10-10/cha/outputs/meusanimes-avaliacao.md.

### AnimesOnlineCC — investigação de 12/10/2026 (sem ativação/publicação)

- Usuário indicou https://animesonlinecc.to/anime/one-piece/ para verificar com o caçador. Site já aparece como candidato na home, sem adaptador. Foram usados os módulos reais do caçador (espião, sondagem e reprodução), mais conferência complementar de player no Chromium.
- Link de One Piece respondeu HTTP 200 e listou 356 episódios, do 835 ao 1180; categoria legendada. Os episódios iniciais não estão no catálogo desse link. One Piece 835 e Tokyo Ravens 1 mostraram “O vídeo está indisponível” no Blogger.
- One Piece 1180 mostrou imagem no player do Blogger e MP4 Googlevideo HTTP 206 em amostra curta. O mesmo endereço não abriu na reprodução interna/sondagem separada do caçador. Não confirmados episódio inteiro, resolução real, idioma/legenda portuguesa ou aparelhos físicos. Classificação: potencial/em análise, sem aprovação.
- Gargalos do caçador: só detecta URLs .mp4/.m3u8, ignora MIME video/mp4, trunca URLs em 500 caracteres e clica só no documento principal. Gerador de fichas usa respostas textuais e exige molde TMDB; não basta adicionar uma URL /videoplayback temporária.
- Integração exige ponte TMDB↔slug↔episódio/Blogger, resolver/renovar URL temporária, compatibilidade do player Android e prova de legenda portuguesa para fonte original. Critério atual de aprovação exige áudio PT + HD em duas obras; não foi relaxado nesta investigação. Numeração TMDB de anime pode ser global (há pedido One Piece T23 E1180), então não somar temporadas sem validar.
- Anime já usa fontes genéricas de séries (WatchPlay/Pipoca/MGEB/Fenix/HD); o problema não é ausência absoluta de fontes. Histórico instalado mostra One Piece T23 E1180 sem solução após seis tentativas; evento play de T1 E1 MGEB não comprova imagem.
- Nenhuma alteração funcional, ficha ativa ou nova versão publicada; versão permanece 2.13.68/398. Relatório: C:/Users/tikto/Documents/Codex/2026-10-10/cha/outputs/anime-animesonlinecc-avaliacao.md. Não gravar URLs Googlevideo temporárias em ficha permanente.

### 2.13.68 / 398 — primeira etapa de estabilidade, publicada em 12/10/2026

- Implementação e publicação continuadas conforme autorização do usuário: https://github.com/invictusbr1/stream-tv-atualizacoes/releases/tag/v2.13.68.
- Filmes e episódios no player interno recuperam uma interrupção após a primeira imagem, procuram uma fonte diferente e mantêm o ponto, temporada/episódio e exigência de português. Máximo de duas trocas automáticas por abertura; fonte que falhou fica excluída. Se não houver alternativa compatível, mantém o progresso e oferece as opções existentes.
- Travamento prolongado: após 6s, Melhor disponível passa para qualidade automática; após 20s sem avanço tenta recuperar. Resolução escolhida manualmente é respeitada. Pausa, busca, término, fechamento e aba oculta não contam como falha. Qualidade mostrada prioriza a imagem medida.
- Diagnóstico por sessão e tentativa na central: tempo até a primeira imagem, posição, travamentos/tempo parado, fornecedor e resultado. Resumos não duplicam falhas nem acionam investigação indevidamente. Persistência com backup, limite de 200 sessões/21 dias e 20 tentativas por sessão; sem URLs temporárias ou credenciais.
- Protegidos os retornos atrasados ao fechar, trocar fonte/episódio e pedir Full HD. TV ao vivo limpa o contexto de filme e mantém controles de transmissão ao vivo.
- Validação: 334 testes, zero falhas/ignorados; três cenários no Chromium real com HLS local e falha HTTP 503 (filme, episódio, fechar durante recuperação), zero erros JavaScript; build/lint celular e Android TV; smoke dos dois executáveis. Vídeo de controle 320x180: prova de recuperação, não de HD nem fornecedor externo.
- Quatro pacotes e downloads públicos completos conferidos por tamanho/SHA256; assinatura Android preservada. Ambos os endereços públicos conferidos na versão 2.13.68/398.
- Código funcional: 580cae5b11730f72f8d0fe76ff136cf53823ec8d. A preparação dos APKs preservou os endereços públicos de central/descoberta/Jarvis/Supabase e o verificador compara esses campos; configuração privada não foi publicada.
- Aplicativo e central instalados no computador atualizados, incluindo index.html externo que tem precedência sobre o pacote. Versão, interface, novo helper e API de diagnóstico conferidos. Configurações e históricos mantidos; executáveis/interface anteriores em C:/Users/tikto/Documents/Codex/2026-10-10/cha/work/backup-instalados-2.13.68.
- Limites: recuperação exige outra fonte interna com suporte ao ponto; iframe externo e conversão incompleta não garantem retomada. Não foi feito teste físico no celular ou Samsung. Mini novelas têm adaptadores próprios, sem nova recuperação específica nesta etapa. Servidor independente do PC e instalação Samsung continuam separados.
- Próximas etapas: sincronizar favoritos/progresso/assistidos por registro e data (incluindo exclusões/offline e renovação de sessão); selos baseados em prova; validação em aparelhos reais e recuperação da versão estável.
- Evidências: C:/Users/tikto/Documents/Codex/2026-10-10/cha/outputs/verificacao-release-2.13.68.json, downloads-publicos-2.13.68.json, recuperacao-2.13.68-player-real.json, instalacao-local-2.13.68.json e primeira-etapa-profissional-2.13.68.md.

### Recomendações de evolução — 12/10/2026 (avaliação, sem implementação)

- Priorizar recuperação da reprodução mantendo posição e qualidade compatível com a conexão; diagnóstico por tentativa/sessão com tempo até a primeira imagem e travamentos. A central já recebe falhas/qualidade/confirmação, mas ainda não associa todas essas medições a uma tentativa única.
- Favoritos, progresso e episódios assistidos já existem. Melhorar a sincronização por registro e data de alteração, exclusões e mudanças offline: auth.js hoje restaura a nuvem apenas quando dados locais estão vazios e publica a coleção local inteira. Revisar também renovação da sessão autenticada.
- Selos Dublado/HD/CC/Sem anúncio nas séries são fixos em library.js; devem refletir prova do título/episódio/fonte, ou permanecer neutros até a reprodução.
- Reforçar testes de uso em aparelhos reais e publicação com recuperação da versão estável; conservar a interface própria de celular/TV. Retomar a instalação Samsung como tarefa separada, conforme condições de conexão.
- Não houve alteração funcional, build ou publicação nesta avaliação. A versão publicada permanece 2.13.67.

### 2.13.67 / 397 — publicada em 12/10/2026

- Publicação autorizada pelo usuário: https://github.com/invictusbr1/stream-tv-atualizacoes/releases/tag/v2.13.67.
- Quatro arquivos publicados: APK celular, APK Android TV, Windows e central. Assinaturas Android preservadas. Downloads públicos completos tiveram tamanho e SHA256 iguais aos arquivos locais aprovados.
- Avisos principal (stream-tv-atualizacoes/latest.json) e reserva (stream-tv-app/docs/latest.json/GitHub Pages) conferidos pela API e pelos endereços públicos em 2.13.67/397.
- Inclui correções MGEB/Sobrevivência e seleção por qualidade medida, referências do fornecedor, exclusão de fontes que falharam em filmes Android e variantes MGEB. Mantém a interface nova do celular da versão 2.13.66 e a interface própria da TV.
- Inclui fortalecimento do caçador: limite de rede/Chromium, fila persistente com recuperação, rodadas com orçamento e pausa, cache parcial curto, aprovação com provas independentes, alternância de categorias e diagnóstico no painel.
- Validação: 295 testes, zero falhas/ignorados; build/lint celular e TV; ambos os executáveis iniciados em ambiente isolado, com interface/motor e diagnóstico/pausa verificados.
- Sobrevivência (2026, TMDB 1236045) tocou no teste de navegador em 1280 × 720 com português confirmado em amostra. Full HD português, filme inteiro e aparelhos Android/TV físicos não foram confirmados.
- Código funcional publicado no commit 96343b563e8fd780052646a40240c780b3964422; endereço automático e fichas atuais do main preservados. Não houve substituição dos executáveis instalados nesta publicação.
- Evidências: C:/Users/tikto/Documents/Codex/2026-10-10/cha/outputs/verificacao-release-2.13.67.json e downloads-publicos-2.13.67.json.

### Sobrevivência / BRFlix — investigação de 12/10/2026 (publicada na 2.13.67)

- Investigado o link informado pelo usuário: `https://brflix.lat/filme/1236045-sobrevivencia` (Sobrevivência, 2026, TMDB 1236045). O portal alterna fornecedores automaticamente; não é possível atribuir a reprodução relatada a um servidor só pelo nome Principal.
- Recuperada a fonte MGEB já existente no Conecta TV: a leitura da página fixa usa IPv4 para evitar o timeout observado nesta rede. O Referer do fornecedor é preservado no motor e no encaminhamento HLS nativo Android. MP4 permanece direto no Android, preservando o avanço/retrocesso e evitando o limite de leitura do proxy HLS; fornecedores MP4 que exigem Referer na reprodução continuam dependendo de suporte específico.
- Reprodução confirmada na interface real do Conecta TV em servidor de teste: 1280 × 720, avanço do vídeo e duração aproximada de 108min. Áudio português confirmado por transcrição de amostra aos 240s; não é prova de reprodução do filme inteiro nem teste físico no Android/TV.
- Registrada prova específica `mgeb|movie:1236045` no histórico de idiomas da central instalada, preservando os demais registros e o backup `idiomas.json.antes-sobrevivencia.bak`. O seletor de teste priorizou MGEB para este título. Nenhum executável instalado foi substituído.
- O avaliador usa a resolução medida antes da indicação do fornecedor. Fichas aprovadas como dubladas retornam `pt-BR`; referências HTTPS públicas e válidas são mantidas. MGEB deixa de declarar 720p para todo MP4 sem medição/rótulo.
- Android ordena as opções MGEB pela resolução declarada e tenta até três vídeos distintos quando a verificação falha. Filmes respeitam `exceto` ao trocar de fonte. Permanece o limite herdado: timeout inconclusivo da validação nativa pode exigir uma falha posterior do player para trocar.
- BRFlix VIP retornou Access Denied no serviço de vídeo. O alternativo HLS não respondeu/tocou nas janelas de teste. Ambos ficaram sem aprovação; Full HD em português ainda não foi confirmado. Não foi adicionada uma receita dependente da chave pública de transporte ou de URLs temporárias do portal.
- Validação: 295 testes automatizados passaram, sem falhas ou testes ignorados, incluindo seis testes JVM do seletor MGEB. Android celular/TV compilados e lint aprovado em cópia de compatibilidade; os APKs dessa cópia não são uma atualização para distribuição.
- Relatório e captura: `C:/Users/tikto/Documents/Codex/2026-10-10/cha/outputs/sobrevivencia-brflix-resultado.md` e `sobrevivencia-player-real.png` na mesma pasta. Esta etapa foi publicada posteriormente na versão 2.13.67; ver registro acima.

### Caçador e estabilidade — estudo de 12/10/2026 (publicado na 2.13.67)

- Fortalecidos os caminhos existentes de descoberta: addons públicos, GitHub, código dos agregadores, mapas dos sites, arquivo da internet e prévias públicas. Consultas têm limite global de 3, uma por domínio, orçamento de resposta/tempo e pausa de 429/503. O player do usuário não compartilha essa fila.
- Varredura tem orçamento de 2 minutos, informa resultado parcial, preserva as descobertas e as retesta depois. Cache persistido: até 6h quando completo; 15min quando vazio, parcial ou falhou. Timers são encerrados ao concluir.
- Fila mantém metadados de addons, alterna domínios entre rodadas, valida dados antigos, recupera backup e recua gradualmente até 24h. Diagnóstico de falha de disco aparece no painel.
- Chromium limitado a uma sondagem, com fila curta, orçamento de tráfego e encerramento do navegador/servidor/conexões. Detecta Chrome/Chromium no Linux também.
- Novas fichas exigem duas provas de títulos e vídeos diferentes, HD >=720 e português confirmado. Falta de medição fica em análise; ficha ativa preserva a receita durante medição incompleta. Suspensões são publicadas mesmo quando não resta ficha ativa.
- Corrigido molde que reutilizava o ID do primeiro título; provas de séries/addons passam tipo TV. Android pula a página inicial quando a ficha já fornece um endereço e preenche também {imdb}.
- Rodadas têm orçamento normal de 20min / profundo de 45min e botão Pausar busca. Podem aguardar uma operação de áudio já iniciada; não iniciam nova análise depois de cancelar. Erro numa categoria não elimina o ranking anterior nem impede as demais.
- Agendamento mantém a cadência existente de 6h, escolhe a categoria menos recentemente tentada a partir do histórico e não volta sempre aos filmes após reiniciar. Com seis categorias, a volta completa ainda pode levar 36h.
- Validação: 276 testes automatizados passaram; Android celular/TV compilados e lint aprovado; vídeo de controle reproduzido em Chromium real (180p, 1507ms para confirmação, sem avaliar fornecedor externo).
- Relatório: C:/Users/tikto/Documents/Codex/2026-10-10/cha/outputs/avaliacao-profissional-cacador.md.
- A etapa inicial não publicou nem trocou executáveis; depois foram gerados pacotes completos e publicada a versão 2.13.67. APKs desta compilação inicial são testes de compatibilidade; não substituir a versão publicada com esses arquivos.
- Limitações: novas fichas legendadas precisam de suporte/prova de legenda antes de aprovação; remoção explícita de ficha ainda não transmite tombstone; validação externa completa de todos os fornecedores não foi executada.

### Correções locais do navegador — 10/10/2026

- Atualizado o executável instalado a partir do código local 2.13.60 para que Futebol no navegador use a mesma interface do APK: banner, jogos ao vivo e cartões sem placares.
- Corrigida a barra do player para larguras pequenas, com botões em linhas e tempo sem quebra. Conferida em 320px, 360px e paisagem 740px.
- Transmissões com `live:true` mostram `AO VIVO` e ocultam avanço/retrocesso, barra de posição e velocidade; abrir um filme depois restaura os controles normais.
- Alterações aplicadas em `index.html`, `playback.js` e nas cópias de assets Android. Dois testes de regressão acrescentados em `playback.test.cjs`; 201 testes passaram.
- Executável local recompilado sem embutir `config.local.json`; configurações permanecem externas. Executável anterior preservado no workspace desta conversa.
- Esta correção local não publica nova release nem envia as alterações existentes da pasta de trabalho ao GitHub. A correção de credenciais do Jarvis dos PRs de segurança continua sendo uma tarefa separada de implantação.

- App: **2.13.47** (versionCode 377) — PC, APK do celular (`br.streamtv.app`),
  APK da TV (`br.streamtv.app.tv`) e web. Manifesto conferido em 10/10/2026.
- Central: **1.5.8** (fichas + placar real + caçada profunda + vetores novos +
  fila persistente + espião no navegador).
- Manifesto: `invictusbr1/stream-tv-atualizacoes` / `latest.json` (app, TV e
  instalador) e `perfis.json` (fichas de fonte + listas de canais + placar).
- 171 testes passam (`npm test`).

## Caminhos

- Código: `C:\Users\tikto\OneDrive\Área de Trabalho\stream tv`
- App instalado: `C:\Users\tikto\Conecta TV\Conecta TV.exe`
- Central instalada: `C:\Users\tikto\Conecta TV Central\Central Conecta TV.exe`
- Dados da central: `C:\Users\tikto\Conecta TV Central\dados`
- APKs/EXEs publicados: `C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\outputs`
- ffmpeg/ffprobe: `%USERPROFILE%\.conecta-central\`
- Downloads dos episódios: `%USERPROFILE%\Downloads\Conecta TV`

## Como publicar uma versão (ordem correta)

1. `npm test` (171 testes precisam passar).
2. Subir a versão em `package.json` e `android/app/build.gradle` (versionCode +1).
3. `npm run build:exe` (aplicativo) e `npm run build:central` (central).
4. `powershell -File android\Build-Android.ps1 -ToolRoot "…\android-tools" -BuildDirectory "C:\Users\tikto\Documents\Codex\android-build-stream-tv" -OutputDirectory "…\outputs"`

   Gera **dois** APKs: `Conecta-TV-Android-<versão>.apk` (celular) e
   `Conecta-TV-TV-<versão>.apk` (TV, `br.streamtv.app.tv`).

5. `powershell -File android\Publicar-Atualizacao.ps1 -ApkPath <apk celular> -ApkTvPath <apk TV> -ExePath <exe> -Notes "<notas>"`

   Sobe os três e confere o manifesto no fim (falha se não bater). Use notas
   SEM acento: o envio pela linha de comando estraga acentos e o GitHub recusa.
   O envio do instalador (119 MB) às vezes cai no meio — o script reenvia.

6. Copiar o exe para `C:\Users\tikto\Conecta TV\` (matar o processo antes) e a
   central para `C:\Users\tikto\Conecta TV Central\`, depois reabrir os dois.
7. `git add -A`, commit em português, push (token na URL, restaurar depois).

   Atenção: `android/app/src/tv/assets/config.json` é gerado pelo build e está
   no `.gitignore` (tem chave dentro) — o GitHub bloqueia o push se ele for junto.

## Caçador de fornecedores (central 1.5.7)

O caçador deixou de ser uma lista e passou a **colocar fonte dentro do
aplicativo**. Como funciona hoje:

1. **Fichas de fonte (`perfis.json`)** — quando o caçador descobre COMO pedir o
   vídeo de um fornecedor, ele grava uma ficha: endereço por título
   (`/filme/{id}`, `/serie/{id}/{temporada}/{episodio}`, addon `{imdb}.json`) e
   a regra de leitura do vídeo (expressão regular, campo de JSON ou player
   embutido). A ficha só é ATIVADA depois de abrir em **dois títulos que não
   serviram de exemplo** — e só entra o que tem áudio em português (ou alta
   definição com legenda) e nenhuma rede de anúncio.
   Quem executa a ficha: `perfis-motor.js` no computador e o mesmo formato no
   aparelho (Java do `MainActivity`). O arquivo publicado é lido pelos dois.
2. **Triagem barata** — antes de gastar IA, o caçador lê as faixas de áudio do
   arquivo (ffprobe) e o que a lista de reprodução HLS declara
   (`#EXT-X-MEDIA LANGUAGE/NAME`). Só quando isso não responde ele ouve o trecho
   (Whisper). Medido: a maioria das fontes passou a ser medida em 2 a 18
   segundos, sem gastar IA.
3. **Caça pelos títulos que falharam** — as amostras de cada categoria são os
   títulos fixos **mais** os que os usuários tentaram e não abriram (ordem por
   falhas seguidas). "Daha 17" entra sozinho na fila.
4. **Descoberta ampliada** — varredor com mais buscas no GitHub (repositórios e
   código), mais sites agregadores, bases de addons do Stremio e, o principal,
   o **mapa do site** (`sitemap.xml`), que revela o molde do endereço de cada
   fornecedor. Medido: 67 candidatas por rodada (antes ~30).
5. **Placar real** — cada abertura, confirmação de que o vídeo tocou e falha
   relatada pelos aparelhos entra numa nota por fonte (`central/placar.js`), que
   entra na nota do caçador **e** na ordem das fontes dentro do aplicativo.
6. **Caçada profunda** — botão no painel (ou `POST /api/cacar {profundo:true}`):
   varre muito mais candidatas, abre as páginas para achar o vídeo e valida
   fichas. O andamento aparece no painel (`/api/cacar/estado`).
7. **TV ao vivo** — listas que já estão no aplicativo entram como MANTIDAS (com
   a nota medida), nunca como "novidade nota 10"; e listas novas aprovadas são
   publicadas junto das fichas, entrando no computador e no celular sem versão
   nova.

Rotas novas da central: `/api/placar`, `/api/perfis`, `/api/cacar/estado`
(todas pedem a chave do painel).

### O que deixou o caçador mais forte (central 1.5.8, 10/10/2026)

1. **Fila persistente** (`central/fila.js`): nada mais se perde entre rodadas.
   Toda candidata achada entra na fila, é tentada em lotes pequenos e volta
   exatamente onde parou. Domínio que só dá erro fica **castigado** (6h; 24h se
   insistir) — trabalha o tempo todo, sem martelar ninguém.
2. **Vetores invisíveis** (`central/vetores.js`):
   - **arquivo da internet (Wayback/CDX)** — revela os formatos de endereço que
     o site já publicou (medido: `pobreflixhd.sbs/filme...`, `brflix.lat/tmdb-cached/...`);
   - **canais públicos do Telegram** (pré-visualização web) — pega domínio
     citado em post; a lista de canais é configurável (a lista testada não
     rendeu: os canais não existiam);
   - **listas guardadas em arquivos públicos** (GitHub) — domínios citados;
   - Common Crawl e crt.sh (certificados) ficam implementados e voltam sozinhos
     quando responderem (na medição: fora do ar / 502).
3. **Cão de caça (espião no navegador escondido)** — abre a página do fornecedor
   e OLHA O QUE ELA PEDE (endereço, método, corpo e resposta). Se alguma
   resposta traz o vídeo, o caçador monta a ficha sozinho. Medido no RedeCanais:
   descobriu `POST /__siteplay/start` (com um `handle` da página) e o host do
   vídeo (warezcdn) — ver pendência 3 abaixo.
4. **Passo de endereço na ficha** — o formato agora aceita "vá direto nesta
   chamada" (`{tipo:'endereco', url:...}`), no computador (`perfis-motor.js`) e
   no aparelho (`MainActivity`). É o que permite usar o que o espião descobriu
   sem precisar ler a página do título.

## Telas: onde cada uma é desenhada (importante!)

- **Navegador/PC**: `index.html` + `library.js` do projeto.
- **Aplicativo do celular/TV**: `android/sync-ui.cjs` gera o `index.html` do APK
  e copia `library.js`, `playback.js`, `legendas.js`, `listas-tv.js` e
  `perfis.json`. **Correção de tela para o celular precisa passar por aqui.**
- O WebView guarda cache: por isso o `sync-ui.cjs` injeta `?v=...` nos scripts e
  as correções de CSS levam marcador único (`busca-final`, `baixar-final`,
  `capas-sem-corte`, `tv-leve`...).
- **Resultado da busca**: cartão vertical igual ao catálogo (capa inteira em
  2/3 e título em até duas linhas).
- **Painel da série**: botão ⤓ de download ao lado do círculo de "assistido".
- **Modo TV** (`html.modo-tv`): letras e capas maiores, foco para controle
  remoto e menos efeitos. O APK da TV abre sempre nesse modo.
- **Fontes do aparelho**: o Java do `MainActivity` resolve as fontes fixas e,
  depois delas, as **fichas** (`/api/playback/...` → `perfilPlayback`).

## Medições desta rodada (10/10/2026)

- Caçada de filmes completa em 7,7 minutos: 67 candidatas do varredor, fontes do
  app medidas com triagem barata, placar real aplicado nas notas.
- **Primeira ficha aprovada**: FenixFlix (FenixHub), filme, dublado 1080p, nota
  7,2 (validada em dois títulos do próprio addon). Os sites de página testados
  não passaram: o SuperFlix pede verificação (Cloudflare Turnstile), o PobreFlix
  usa id próprio (não o do TMDB) e o RedeCanais usa o id do TMDB mas carrega o
  player por chamada interna (não está no HTML).
- Placar real já com dados: WatchPlay 23 aberturas/11 confirmações/10 falhas
  (ajuste +0,39), PipocaCine 5/18 (‑0,67), FenixFlix 17/2 (+0,79).

## Pendências abertas

0. **Cobertura de fonte no aparelho (feito em 2.13.47):** o celular/TV agora
   também cai para a **segunda opção da regra** — alta definição limpa com
   legenda em português (Vixsrc, portado para o Java do `MainActivity`) — quando
   nenhuma fonte dublada tem o título. Antes, nesses títulos, o aparelho dizia
   "nenhuma fonte" enquanto o computador abria legendado. Ordem no aparelho:
   dublado (WatchPlay → PipocaCine → MGEB) → fichas do caçador → HD com legenda.
   Medido no computador: 8/8 títulos populares abrem; nos títulos sem dublado o
   computador tinha segunda opção e o aparelho não — agora tem.
   Próximo item combinado com o usuário: **botão "Pedir este título"** (o pedido
   entra na frente da fila do caçador) e depois os três fornecedores que faltam
   destravar (PobreFlix com clique no servidor, Pomfy com passo de busca,
   RedeCanais com passo POST).

1. **Primeira ficha aprovada: FenixFlix (FenixHub), filme, dublado 1080p, nota
   7,2** — o addon do Stremio responde JSON com o vídeo; a ficha foi validada em
   dois títulos que ele tem ("Um Sonho de Liberdade": faixa de áudio em
   português, padrão do arquivo; e "Batman: O Cavaleiro das Trevas": 2160p).
   O endereço vem em `http://` e o caçador o promove para `https://` (o mesmo
   servidor responde nos dois; medido em 10/10/2026). É esta ficha que abre no
   computador e no celular sem versão nova — conferir em `/api/perfis` e no
   bloco "Fichas de fonte aprovadas" do painel.
   **Conferido no aplicativo instalado (2.13.45, 10/10/2026):** com as fontes
   fixas fora do caminho (`/api/playback/278?exceto=watchplay,pipoca,mgeb,fenix,
   pipoca-serie,vixsrc,vidsrc`) o aplicativo responde
   `fonte=FenixFlix (FenixHub), fonteId=fenixflix-fenixhub, audio=dublado,
   resolucao=1080p` — e o mesmo no título 155. Para isso o aplicativo agora
   busca o código IMDb do título no TMDB (o addon é pedido por esse código).
   O que faltava para ela passar: (a) usar o MOLDE certo por tipo (antes uma
   amostra de série virava molde de filme), (b) validar nos títulos que o addon
   realmente tem em vez dos títulos fixos do aplicativo, (c) mandar o
   identificador IMDb para a validação e (d) pôr os ENDEREÇOS dos addons antes
   dos links soltos na lista de candidatas (os links avulsos ocupavam as
   primeiras vagas e o endereço nem era testado).
2. **Ficha de SÉRIE do mesmo addon** — as chamadas de série devolveram vídeo em
   1 de 3 títulos na hora da validação (os endereços são temporários). Fica
   pendente até o caçador pegar uma janela com dois títulos abrindo.
3. **Passo POST na ficha (ex.: RedeCanais)** — o espião já achou o caminho
   (`POST /__siteplay/start` com `{"handle": "ph_…"}` tirado da página, que
   devolve o player em `warezcdn.sbs`). Falta a ficha saber fazer POST com corpo
   (hoje ela só faz GET). É o próximo aumento de força — com ele, sites que só
   montam o player por JavaScript passam a virar fonte.
   O teste é direto: `push` no caçador e ver se a ficha abre em dois títulos.
4. **Placar de vetores** — contar qual vetor (GitHub, arquivo da internet,
   espião, mapa do site…) rendeu ficha aprovada e investir mais nele. Hoje o
   caçador roda todos com o mesmo peso.
4. **Instalar o APK da TV na TV box**: o pacote `br.streamtv.app.tv` sai em cada
   versão, mas a Xiaomi TV Box ainda usa o APK do celular.
5. **Atualização no celular — confirmar no aparelho**: o aparelho "111" estava
   em 2.13.27; o resultado de cada conferência vai para a central (evento
   `tipo=atualizacao`, campo `motivo`).
6. **Download no celular**: hoje o download de verdade é no computador
   (`baixador.js` → `Downloads\Conecta TV`, MP4 com áudio português).

## Regras do produto (não negociáveis)

1. Dublado primeiro; 2. Sem anúncio; 3. HD/Full HD; 4. Abrir automático;
5. Interface limpa; 6. Toda versão publicada (exe + APK + manifesto);
7. Medir de verdade antes de afirmar.

## Robôs rodando

- **Vigia das fontes** (`vigia-fontes.js`): 2 títulos a cada 12 min, mede,
  afasta fonte quebrada (castigo 20 min; 4h se insistir). Estado: `/api/vigia`.
- **Central 1.5.7**: agente (investiga falhas), revisor (30 min), caçador
  (6h por categoria, com fichas, placar e caçada profunda) e varredor
  (addons do Stremio + GitHub + código dos sites + mapa dos sites).

## Estudo do projeto — 10/10/2026

- Código e manifesto local em 2.13.57 (versionCode 387); a indicação 2.13.47 acima é histórica.
- Suíte executada neste estudo: 194 testes passaram, zero falhas.
- Na inspeção: app na porta 3000, central na 4100; fila com 127 candidatas e duas fichas desativadas.
- Diagnóstico salvo em C:\Users\tikto\Documents\Codex\2026-10-10\es\outputs\ESTUDO-STREAM-TV.md.
- Pontos para corrigir: aprovação final sem exigir toda a regra de idioma/HD/legenda; diferenças de seleção de fichas PC/Android; mutação do molde em perfis-motor.resolver; passos POST ainda ausentes; eventos sem vínculo por sessão.
- Apenas estudo e testes: nenhuma fonte ou versão publicada e nenhuma mudança na lógica.


- Teste LA18HD (10/10/2026): player premiere1 reproduziu imagem no Chrome por cerca de 70 s entre medições, sem erro reportado; resolução 1024x576, abaixo de HD. Candidata, sem aprovação/publicação. TV box e áudio não verificados. Relatório: C:\Users\tikto\Documents\Codex\2026-10-10\es\outputs\TESTE-LA18HD.md.


## Integração LA18HD — 10/10/2026
- Versão local 2.13.58, versionCode 388; não publicada no manifesto automático.
- Windows instalado e reiniciado em C:\Users\tikto\Conecta TV. Backup anterior preservado na pasta work desta tarefa.
- TV ao vivo → Mais opções de futebol → LA18HD · Premiere, opcional em 576p conforme interesse expresso do usuário.
- Resolve a URL temporária por abertura, sem executar scripts da página do fornecedor. Windows via HLS proxy; Android via interceptação nativa independente do PC.
- 196 testes passam. Decodificação real 120 s sem erros; player integrado ativo por mais de 130 s. Imagem 1024x576, H.264/AAC; amostra de áudio 12 s em português.
- EXE e APKs celular/TV compilados. Análise Android e assinaturas verificadas. Endpoint do EXE instalado autenticado e funcional.
- Sem aparelho Android conectado: reprodução física ainda pendente. Não comprova cobertura de Premier League/Copa do Brasil nem estabilidade por uma partida inteira.
- Entregas e relatório: C:\Users\tikto\Documents\Codex\2026-10-10\es\outputs.

- Publicação autorizada e executada: release v2.13.58 com EXE e dois APKs enviados. latest.json confirmado pela API e URL do commit em 2.13.58/388; três hashes SHA256 conferidos. Cache do endereço main temporariamente retornava 2.13.57 (max-age 300); script apresentou falha nessa conferência apesar do commit correto.

- Conferência após publicação: baixados os três arquivos do release v2.13.58 e comparados SHA256 com os builds locais; todos idênticos. APKs confirmados por aapt: celular br.streamtv.app, TV br.streamtv.app.tv, versão 2.13.58/388; ambos contêm botão LA18HD, endpoint e rótulo 576p. API latest.json correta; endereço raw main ainda retornava cache 2.13.57 nesta conferência.

## Futebol e correção Android — 2.13.59 (10/10/2026)
- Relato do usuário: LA18HD não abriu no celular. Encontrada causa: enderecoSeguro rejeitava :443 explícito, usado pelo CDN. Corrigido com La18Source.httpsPort; teste Java de regressão aprovado.
- Página Futebol exclusiva no menu/gaveta: agenda ESPN de Premier League, Brasileirão e Copa do Brasil (slug bra.copa_do_brazil), data, filtro campeonato/ao vivo, placar, horários Brasília e transmissão quando informada. Atualiza a cada minuto; não inventa vínculo jogo→fornecedor.
- 198 testes aprovados; build/lint/assinaturas Android celular/TV aprovados; APKs 2.13.59/389 verificados. Reprodução browser 576p ativa >36s; sem Android físico conectado.
- Windows instalado, hash idêntico; página e endpoint de agenda autenticados verificados no instalado.
- Publicados EXE + dois APKs v2.13.59; hashes/tamanhos do GitHub conferidos e manifesto público 2.13.59/389 confirmado pelo publicador.
- Relatório e captura em outputs desta tarefa: FUTEBOL-2.13.59.md e futebol-2.13.59.png.
- Publicador agora confere manifesto gravado e hashes pela API caso o CDN raw esteja atrasado, em vez de reportar falso envio falho.

## Correção de interface — 2.13.60 (10/10/2026)
- Pedido explícito: Futebol separado de TV; somente ao vivos, sem placares, banner em destaque e foco na transmissão. TV única com busca, sem abas/categorias/seletor de listas.
- Implementado banner ilustrado de estádio com CTA direto Premiere; jogos live com escudos e opções de transmissão, sem inventar vínculo jogo→canal. Removidos resultados, placares e seleção de data/liga.
- TV usa lista brasileira única. Corrigida dependência de busca inexistente no Windows; busca Globo validada.
- 199 testes aprovados; Android celular/TV build/lint/assinaturas aprovados e interface final conferida nos APKs. EXE contém interface e busca finais. Teste visual no servidor do projeto; reprodução pelo banner 21s, 1024x576, sem erro.
- Publicados três arquivos v2.13.60 com hashes do GitHub conferidos; manifesto gravado 2.13.60/390. Cache raw pode atrasar aviso. Windows instalado permanece na versão anterior; atualização disponível.
- Usuário vai enviar link Futmax para testar alternativa. Não integrado ainda. Aparelho Android físico não conectado.
- Captura e relatório: outputs/futebol-2.13.60.png e FUTEBOL-2.13.60.md.

### Agenda e transmissão — 10/10/2026
A agenda ESPN não identifica o programa exibido no canal Premiere1. Removido o botão por partida que abria canais genéricos e identificado o caráter informativo da agenda. Nome de partida na transmissão depende de programação confirmada do fornecedor; não fixar nomes de times. Fonte e assets Android alinhados. Quatro testes de futebol aprovados, incluindo regressão da associação incorreta.


## Mininovelas — integração inicial
Categoria própria com ReelShort e DramaBox, dados públicos e episódios liberados no player interno. Interface e leitura nativa Android alinhadas; compilação Java aprovada. Caçador ganha categoria short-drama sem usar IDs TMDB, mede prévias e não promove catálogo completo a partir de uma amostra. NetShort, ShortMax, DramaWave e FreeReels continuam pendentes de reprodução validada; Sua Novela aguarda link do usuário. Testes: 208 aprovados e vídeos verticais reais de dois fornecedores reproduzidos em navegador. Não publicado nem instalado nos aparelhos nesta etapa.


## Doraminhas TV — 2.13.64

Seleção ReelShort do catálogo público integrada, com o título enviado pelo usuário em destaque. Lista de episódios e reprodução interna; a liberação é conferida novamente ao abrir cada episódio, sem cookies ou conta do fornecedor. Episódio 2 de Peão Descartado, O Incomparável Rei Dragão reproduzido em 1080 × 1920 na interface de teste. Caçador da central registra testes da fonte. Nenhuma afirmação de catálogo completo ou dublagem verificada.
