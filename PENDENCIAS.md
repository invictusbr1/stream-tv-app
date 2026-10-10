# Conecta TV — estado e pendências (ler antes de qualquer tarefa)

> Este arquivo é a memória do projeto. Abrir SEMPRE no começo de uma tarefa e
> atualizar no fim. Assim nada precisa ser repetido pelo usuário.

## Última versão publicada

- App: **2.13.40** (versionCode 370) — PC, APK do celular (`br.streamtv.app`),
  APK da TV (`br.streamtv.app.tv`) e web. Manifesto conferido em 10/10/2026.
- Central: **1.5.6**.
- Manifesto: `invictusbr1/stream-tv-atualizacoes` / `latest.json` — agora traz
  `apkUrl` (celular), `apkTvUrl` (TV) e `exeUrl` (computador), com sha256 e
  bytes. O `Publicar-Atualizacao.ps1` **confere o manifesto no fim e falha** se
  ele não bater (era o que faltava na 2.13.33).

## Caminhos

- Código: `C:\Users\tikto\OneDrive\Área de Trabalho\stream tv`
- App instalado: `C:\Users\tikto\Conecta TV\Conecta TV.exe`
- Central instalada: `C:\Users\tikto\Conecta TV Central\Central Conecta TV.exe`
- APKs/EXEs publicados: `C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\outputs`
- ffmpeg/ffprobe: `%USERPROFILE%\.conecta-central\` (é o que o download usa)
- Downloads dos episódios: `%USERPROFILE%\Downloads\Conecta TV`

## Como publicar uma versão (ordem correta)

1. `npm test` (149 testes precisam passar).
2. Subir a versão em `package.json` e `android/app/build.gradle` (versionCode +1).
3. `npm run build:exe`.
4. `powershell -File android\Build-Android.ps1 -ToolRoot "C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\work\android-tools" -BuildDirectory "C:\Users\tikto\Documents\Codex\android-build-stream-tv" -OutputDirectory "C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\outputs"`

   Gera **dois** APKs: `Conecta-TV-Android-<versão>.apk` (celular,
   `br.streamtv.app`) e `Conecta-TV-TV-<versão>.apk` (TV, `br.streamtv.app.tv`).

5. `powershell -File android\Publicar-Atualizacao.ps1 -ApkPath <apk celular> -ApkTvPath <apk TV> -ExePath <exe> -Notes "<notas>"`

   Sobe os três na mesma versão e escreve os três endereços no manifesto.

6. Conferir o manifesto em
   `https://raw.githubusercontent.com/invictusbr1/stream-tv-atualizacoes/main/latest.json`
   (o passo 5 já confere e falha se não bater).
7. Copiar o exe para `C:\Users\tikto\Conecta TV\`, matar o processo antigo e reabrir.
8. `git add -A`, commit em português, push (token na URL, restaurar depois).

   Atenção: `android/app/src/tv/assets/config.json` é gerado pelo build e está
   no `.gitignore` (tem chave dentro) — o GitHub bloqueia o push se ele for junto.

## Telas: onde cada uma é desenhada (importante!)

- **Navegador/PC**: `index.html` + `library.js` do projeto.
- **Aplicativo do celular/TV**: `android/sync-ui.cjs` gera o `index.html` do APK
  (transformações) e copia `library.js`, `playback.js`, `legendas.js` etc.
  → **correção de tela para o celular precisa passar por aqui**, senão o
  aparelho continua com o visual antigo.
- O WebView guarda cache: por isso o `sync-ui.cjs` injeta `?v=...` nos scripts
  e as correções de CSS levam um comentário-marcador único (`busca-final`,
  `baixar-final`, `capas-sem-corte`, `tv-leve`...).
- **Resultado da busca** (web e aparelho): cartão vertical igual ao do catálogo —
  capa inteira (`object-fit:contain`, 2/3) e título em até 2 linhas. Quem manda
  é a regra `busca-final` (em `index.html` e repetida em `sync-ui.cjs`); o
  visual antigo em linha (capa 92x138 + coluna de texto de 15px, que cortava o
  título) foi removido.
- **Painel da série**: o botão ⤓ de download fica ao lado do círculo de
  "assistido" (`#series-dialog .episode-baixar`, criado no `library.js`).
- **Modo TV** (`html.modo-tv`, entra com `?canal=tv` ou aparelho sem toque):
  letras e capas maiores, foco para controle remoto e menos efeitos (`tv-leve`).
  O APK da TV (`br.streamtv.app.tv`) abre sempre nesse modo.

## Pendências abertas

1. **Atualização no celular — confirmar no aparelho.** Medido em 10/10/2026: o
   aparelho "111" (Celular Android) reporta **2.13.27** (versionCode 357) e o
   manifesto já estava em 2.13.38 (368) — deveria, então, oferecer. O que foi
   corrigido (2.13.39/2.13.40): o aviso procura o manifesto em quatro endereços
   (raw.githubusercontent, github.com, jsDelivr, página do app), a comparação é
   versionCode x versão **instalada** e o resultado de cada consulta (inclusive
   do código Java) vai para a central como evento `tipo=atualizacao` com
   `instalada`, `publicada`, `resultado`, `motivo` e `canal`. Próximo passo: no
   celular, tocar **Atualizar aplicativo** (na gaveta) e olhar na central o que
   ele mediu; é esse `resultado`/`motivo` que diz se a rede do aparelho bloqueia
   o manifesto.
2. **Instalar o APK da TV na TV box**: o pacote `br.streamtv.app.tv` já sai em
   cada versão, mas a Xiaomi TV Box ainda está com o APK do celular. Instalar
   uma vez o `Conecta-TV-TV-<versão>.apk` (depois o aviso de atualização manda
   o APK certo para ele).
3. **Download no celular**: o download de verdade é feito pelo computador
   (`baixador.js` + ffmpeg → `Downloads\Conecta TV`, MP4 com áudio português).
   No celular o botão ⤓ avisa que o download é no computador — baixar no próprio
   aparelho precisa de código nativo (o WebView sozinho não grava HLS).
4. **Fontes sem dublado — "Daha 17" (turca 2026).** Medido em 10/10/2026 pelo
   motor: `escolher('dublado')` e `escolher('hd')` para 317883 T1E1 devolvem
   `null` (nenhuma fonte tem o episódio ainda). O vigia roda sozinho e o título
   está na fila dele (108 títulos, incluindo séries turcas), então volta na
   frente nas próximas rodadas e o episódio abre sozinho quando aparecer.

## Regras do produto (não negociáveis)

1. Dublado primeiro; 2. Sem anúncio; 3. HD/Full HD; 4. Abrir automático;
5. Interface limpa; 6. Toda versão publicada (exe + APK + manifesto);
7. Medir de verdade antes de afirmar.

## Robôs rodando

- **Vigia das fontes** (`vigia-fontes.js`): 2 títulos a cada 12 min, mede,
  afasta fonte quebrada (castigo 20 min; 4h se insistir). Estado: `/api/vigia`.
- **Central**: agente (investiga falhas), revisor (30 min), caçador (6h por
  categoria) e varredor (addons Stremio + GitHub + código dos sites).
