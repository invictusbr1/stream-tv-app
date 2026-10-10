# Conecta TV — estado e pendências (ler antes de qualquer tarefa)

> Este arquivo é a memória do projeto. Abrir SEMPRE no começo de uma tarefa e
> atualizar no fim. Assim nada precisa ser repetido pelo usuário.

## Última versão publicada

- App: **2.13.38** (versionCode 368) — PC, APK e web.
- Central: **1.5.6**.
- Manifesto de atualização: `invictusbr1/stream-tv-atualizacoes` / `latest.json`
  (conferir SEMPRE depois de publicar: às vezes o `Publicar-Atualizacao.ps1`
  sobe o APK e **não** atualiza o manifesto — foi o que aconteceu na 2.13.33).

## Caminhos

- Código: `C:\Users\tikto\OneDrive\Área de Trabalho\stream tv`
- App instalado: `C:\Users\tikto\Conecta TV\Conecta TV.exe`
- Central instalada: `C:\Users\tikto\Conecta TV Central\Central Conecta TV.exe`
- APKs/EXEs publicados: `C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\outputs`
- Scripts de teste: `C:\Users\tikto\Documents\Codex\2026-10-06\oi\work`
- ffmpeg/ffprobe: `%USERPROFILE%\.conecta-central\`

## Como publicar uma versão (ordem correta)

1. `npm test` (149+ testes precisam passar).
2. Subir versão em `package.json` e `android/app/build.gradle` (versionCode +1).
3. `npm run build:exe`.
4. `powershell -File android\Build-Android.ps1 -ToolRoot "C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\work\android-tools" -BuildDirectory "C:\Users\tikto\Documents\Codex\android-build-stream-tv" -OutputDirectory "C:\Users\tikto\Documents\Codex\2026-09-28\a-chat-te-der-permiss-o\outputs"`
5. `powershell -File android\Publicar-Atualizacao.ps1 -ApkPath <apk> -Notes "<notas>"`.
6. **Conferir o manifesto** em
   `https://raw.githubusercontent.com/invictusbr1/stream-tv-atualizacoes/main/latest.json`
   e, se estiver atrasado, atualizar via API do GitHub (token em `%USERPROFILE%\.streamtv\github-token.txt`).
7. Copiar o exe para `C:\Users\tikto\Conecta TV\`, matar o processo antigo e reabrir.
8. `git add -A`, commit em português, push (token na URL, restaurar depois).

## Telas: onde cada uma é desenhada (importante!)

- **Navegador/PC**: `index.html` + `library.js` do projeto.
- **Aplicativo do celular/TV**: `android/sync-ui.cjs` gera o `index.html` do APK
  (transformações) e copia `library.js`, `playback.js`, `camera.js` etc.
  → **correção de tela para o celular precisa passar por aqui**, senão o
  aparelho continua com o visual antigo (foi o que causou ~5 rodadas perdidas).
- O WebView guarda cache: por isso o `sync-ui.cjs` injeta `?v=...` nos scripts
  e as correções de CSS levam um comentário-marcador único.

## Pendências abertas

1. **Capa cortada na busca** — o usuário informa que continua cortada na **web**
   e no APK. A regra `#resultados .card img{object-fit:contain}` foi aplicada,
   mas o resultado da busca no celular **não é um `.card`** (a imagem apareceu
   com caixa 0x0 na inspeção). Próximo passo: inspecionar o HTML real do
   resultado da busca dentro do APK (não do navegador) e ajustar o seletor certo.
2. **Atualização não aparece no celular** — manifesto está em 2.13.38 e o
   release existe; verificar no aparelho qual versão está instalada
   (Ajustes do app) e como o `AppUpdater` compara (versionCode x versionName).
3. **APK de TV dedicado** (pacote `br.streamtv.app.tv`, 10 pés, D-pad) —
   hoje é o mesmo APK com `?canal=tv` quando o aparelho não tem tela de toque.
4. **Publicação tripla** (celular + TV + web) num comando só — falta juntar o
   APK de TV no `Publicar-Atualizacao.ps1` e no manifesto.
5. **Download de verdade** do episódio (o botão ⤓ hoje só avisa).
6. **Fontes sem dublado**: "Daha 17" (turca 2026) e outras — vigia testa sozinho.

## Regras do produto (não negociáveis)

1. Dublado primeiro; 2. Sem anúncio; 3. HD/Full HD; 4. Abrir automático;
5. Interface limpa; 6. Toda versão publicada (exe + APK + manifesto);
7. Medir de verdade antes de afirmar.

## Robôs rodando

- **Vigia das fontes** (`vigia-fontes.js`): 2 títulos a cada 12 min, mede,
  afasta fonte quebrada (castigo 20 min; 4h se insistir). Estado: `/api/vigia`.
- **Central**: agente (investiga falhas), revisor (30 min), caçador (6h por
  categoria) e varredor (addons Stremio + GitHub + código dos sites).
