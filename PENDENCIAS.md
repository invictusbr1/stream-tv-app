# Conecta TV — estado e pendências (ler antes de qualquer tarefa)

> Este arquivo é a memória do projeto. Abrir SEMPRE no começo de uma tarefa e
> atualizar no fim. Assim nada precisa ser repetido pelo usuário.

## Última versão publicada

- App: **2.13.45** (versionCode 375) — PC, APK do celular (`br.streamtv.app`),
  APK da TV (`br.streamtv.app.tv`) e web. Manifesto conferido em 10/10/2026.
- Central: **1.5.7** (painel com fichas + placar real + caçada profunda).
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
3. **Sites com chamada interna (ex.: RedeCanais)** — o player só aparece depois
   de uma chamada do site. Para cobrir isso a ficha precisa de um passo de API
   (buscar um segundo endereço e ler o campo) — é o próximo aumento de força.
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
