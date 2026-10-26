# Fontes de anime — verificação

**Data:** 25/10/2026 · **Produção:** Oracle (`https://147.15.28.222`)

## Resposta curta

**Sim, temos anime — por dois caminhos diferentes:**

1. **Dublado (amplo):** usa o fluxo normal de séries (Fenix/FrostStream/Kairou/
   MGEB). Testado em 6 títulos: todos abriram em **720p/1080p, áudio `pt-BR`**.
2. **Legendado (restrito):** dois resolvedores, **Meus Animes** (embed do
   Blogger) e **PROPLAYER** (MP4 direto). O Meus Animes está no ar, mas o código
   só libera **One Piece** e **Solo Leveling**; o PROPLAYER está **403**
   (Cloudflare) tanto no PC quanto na Oracle, então não entrega nada hoje.

O app Android usa o caminho **nativo** para legendado: `AnimeSource.java` tem a
mesma lista de 2 títulos e o fallback PROPLAYER está bloqueado. Para dublado, o
app usa o fluxo normal e funciona.

## 1. Dublado — testado na Oracle

`GET /api/playback/serie/<tmdb>/<temporada>/<episódio>`

| Anime | TMDB | Ep. | Fonte | Qualidade | Áudio |
|---|---|---|---|---|---|
| One Piece | 37854 | T1E1 | FenixFlix | 1080p | `pt-BR` |
| Solo Leveling | 127532 | T1E1 | FenixFlix | 1080p | `pt-BR` |
| Jujutsu Kaisen | 95479 | T1E1 | Fenix | 1080p | `pt-BR` |
| Demon Slayer | 85937 | T1E1 | Kairou · VeTela | 1080p | `pt-BR` |
| Demon Slayer | 85937 | T2E1 | Kairou · VeTela | 1080p | `pt-BR` (URL `S02E01`) |
| Attack on Titan | 1429 | T1E1 | MGEB | 720p | `pt-BR` |
| My Hero Academia | 31910 | T1E1 | MGEB | 720p | `pt-BR` |

O episódio da segunda temporada do Demon Slayer veio com o nome
`Demon Slayer S02E01.mp4` — a numeração não ficou presa no E1.

## 2. Legendado — o que existe e o que está liberado

### Meus Animes (`anime-source.js`)

- **No ar** na Oracle: `/api/anime-player?id=37854...` devolve
  `meus-animes | embed | Meus Animes · legendado` em ~1,3 s.
- **Solo Leveling** também: `/api/anime-player?id=127532...` → `meus-animes`.
- **Solo Leveling E13** → `providerEpisode: {season:2, number:1}` (a ponte
  `solo-12-13` está correta).
- A **API do fornecedor** (`serv01.meusdoramas.club`) responde com vídeo para
  **Jujutsu Kaisen (95479), Demon Slayer (85937), Attack on Titan (1429),
  My Hero Academia (31910)** e outros. Mas o `CATALOGO` do `anime-source.js` é
  fechado em:

```js
'37854':   { slug: 'one-piece',    numeracao: 'absoluta' },
'127532':  { slug: 'solo-leveling', numeracao: 'solo-12-13' }
```

Por isso a rota devolve `ok:false` para os demais, mesmo com o fornecedor tendo
o vídeo. Não é falta de fonte: é **allowlist conservadora** (evita abrir outro
anime/episódio por aproximação).

### PROPLAYER (`anime-proplayer-source.js`)

- Feito para devolver **MP4 direto ≥720p, sem anúncio, legenda embutida**
  (`fonteId: proplayer-legendado`); é o caminho preferido para o player nativo.
- **Hoje o site `assistiranimesonline.net` responde 403** (Cloudflare) tanto do
  PC quanto da Oracle. A API do Meus Animes responde 200; o PROPLAYER não.
- Resultado: o fallback genérico do app para legendado não funciona enquanto o
  site estiver bloqueado.

## 3. Caminho no código

- **Servidor:** `/api/anime-player` (`server.js`) valida `id`, temporada,
  episódio e áudio; tenta `anime-source` (Meus Animes) e depois
  `anime-proplayer-source` (PROPLAYER); devolve `ok:false` se nenhum servir.
- **Cliente web/TV:** `anime-player.js` só abre para `episode.anime === true` e
  áudio `legendado`; valida `fonteId`, URL do Blogger/MP4 e o episódio; para
  `dublado` devolve `false` e o app segue pelo fluxo normal de séries.
- **Android nativo:** `AnimeSource.java` (Meus Animes) aceita **somente**
  `37854` e `127532`; `animeDireto` tenta o PROPLAYER genérico, que está 403.
  O `anime-player.js` do APK também só usa legendado; ao escolher dublado, cai
  no `/api/playback/serie/...` normal.
- **Catálogo:** o filtro de anime (animação + JP/KR/ja) está no
  `android/app/src/main/assets/catalog.js` e nos testes de integração.

## 4. Testes

```
node --test anime-source.test.cjs anime-proplayer-source.test.cjs \
  anime-player.test.cjs anime-integracao.test.cjs
# 36 passando
```

## 5. Limites e próximos passos

1. **Legendado amplo:** a API do Meus Animes já tem JJK, Demon Slayer, AoT,
   MHA etc. Para liberar, é preciso acrescentar entradas verificadas ao
   `CATALOGO` (com a regra de numeração de cada título) e testar episódio a
   episódio. É uma mudança de allowlist — não vale liberar por aproximação.
2. **Android:** mesmo liberando no servidor, o `AnimeSource.java` continua com
   2 títulos. Ou se amplia a lista no Java (novo APK), ou o app passa a cair no
   `/api/anime-player` da Oracle quando o nativo não souber o título.
3. **PROPLAYER:** o site está 403; ou se troca o domínio/estratégia, ou se
   assume o Meus Animes como fonte legendada principal.
4. **Dublado:** já está amplo e não depende dessas duas fontes; é a opção
   prática para a maior parte dos animes hoje.

## 6. Como reproduzir

```bash
# legendado (One Piece e Solo Leveling)
CODIGO=$(curl -sS https://invictusbr1.github.io/stream-tv-app/endereco.json \
  | python -c "import sys,json;print(json.load(sys.stdin)['codigo'])")
curl -skS "https://147.15.28.222/api/anime-player?id=37854&temporada=1&episodio=1&audio=legendado&tipo=tv&codigo=$CODIGO"
curl -skS "https://147.15.28.222/api/anime-player?id=127532&temporada=1&episodio=13&audio=legendado&tipo=tv&codigo=$CODIGO"

# dublado (fluxo normal)
curl -skS "https://147.15.28.222/api/playback/serie/95479/1/1?codigo=$CODIGO"
```
