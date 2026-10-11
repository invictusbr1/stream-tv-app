# Conecta TV — estado e pendências (ler antes de qualquer tarefa)

> Este arquivo é a memória do projeto. Abrir SEMPRE no começo de uma tarefa e
> atualizar no fim. Assim nada precisa ser repetido pelo usuário.

## Última versão publicada

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
