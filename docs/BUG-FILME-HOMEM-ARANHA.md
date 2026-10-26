# Homem-Aranha: Um Novo Dia (TMDB 969681) — o 4K não carregava

**Data:** 25/10/2026 · **Produção:** Oracle (`https://147.15.28.222`)

## Sintoma

O filme abria a página, mas o player não carregava. A prioridade de qualidade
continuava escolhendo a fonte **4K** — e era justamente ela que não iniciava em
alguns aparelhos/TVs.

## O que a Oracle estava entregando

`GET /api/playback/969681` (sem `codec`):

| Campo | Valor |
|---|---|
| Fonte | `fenixflix-fenixhub` · FenixFlix 4K |
| Dimensões | 3832 × 1600 (HEVC) |
| Duração | 8700,651 s (2h25) |
| Tamanho | **7.019.508.832 bytes (~7 GB)** |
| Áudio | `pt-BR` (padrão do arquivo) |

O arquivo **é válido**: o ffprobe leu e o Chrome tocou (`tocou: true`, 1600p,
7,7 s). O problema não era a fonte, e sim o aparelho/TV: WebView sem HEVC,
decodificador que anuncia HEVC mas não renderiza o 4K, ou rede que não inicia um
arquivo de 7 GB em 12 s.

## A causa no cliente

O `playback.js` já tinha o pedido de reserva `compat=avc` (H.264), mas:

```js
const podeCompat = !urlDireta && !televisao && ...
```

A **TV ficava de fora** — justamente o aparelho que mais precisa do H.264. Além
disso, o fallback só era tentado **antes da primeira imagem**; um erro depois
disso ia direto para "reprodução interrompida".

## A correção

- `podeCompat` agora vale para a TV também.
- O fallback `compat=avc` é tentado depois de **12 s sem imagem** ou de **erro
  do arquivo** (inclusive depois da primeira imagem).
- O **4K continua sendo a primeira escolha**; a reserva só entra quando o 4K não
  apresenta imagem/erro. Nenhuma regra de qualidade ou dublado foi afrouxada.

A reserva `compat=avc` na Oracle devolveu:

| Campo | Valor |
|---|---|
| Fonte | `kairou` · Kairou/VeTela |
| Arquivo | `Homem-Aranha Um Novo Dia.2026.1080p.WEB-DL.x264.DUAL.5.1.mp4` |
| Dimensões | 1920 × 1080 (H.264) |
| Duração | 8700,672 s |
| Tamanho | 3.058.159.577 bytes (~3 GB) |
| Áudio | **`por` como faixa padrão** |

É o filme certo, 1080p, dublado. O 4K continua ganhando quando o aparelho
consegue; quando não, o 1080p H.264 entra sozinho.

## Testes

```
node --test playback.test.cjs
# 73 passando
```

Inclui o novo caso **“TV sem HEVC também consulta a versão compatível”** e os
casos existentes de Chrome/APK/HEVC/4K, para não quebrar a prioridade.

## Publicação

- **Oracle:** release `a3848d2f5177` publicada e verificada (`healthy`, 18:53).
  O `/playback.js` servido pela Oracle já tem o fallback da TV.
- **Release 2.13.115:** APK celular, APK TV e EXE; feed `latest.json`
  `versionCode 445`.
- **Servidor local:** continua desligado; a produção é a Oracle.

## Como verificar

```bash
CODIGO=$(curl -sS https://invictusbr1.github.io/stream-tv-app/endereco.json \
  | python -c "import sys,json;print(json.load(sys.stdin)['codigo'])")

# 4K (primeira escolha)
curl -skS "https://147.15.28.222/api/playback/969681?codigo=$CODIGO"

# reserva H.264 1080p dublada (quando o 4K não abre)
curl -skS "https://147.15.28.222/api/playback/969681?codigo=$CODIGO&compat=avc"
```

No app: atualize para **2.13.115** e abra o filme. Ele tenta o 4K; se a TV/
aparelho não apresentar imagem em 12 s ou der erro, cai no 1080p H.264 dublado.

## Atualização 2.13.116 — 4K no APK e no Safari

O arquivo 4K é **HEVC Main 10, `hvc1`, 3832×1600, 7,0 GB, áudio `por`
(5.1), 8700 s**. O `hvc1` é justamente o formato que o Safari toca. O problema
não era codec: o CDN do FenixFlix **exige Referer**. Sem Referer ele responde
um arquivo vazio (0 byte); com o proxy do servidor, responde **206 Partial
Content** com os 7 GB.

- **Safari/web:** `fontes-motor.prepararParaPlayer` agora manda fontes
  `final` de 4K/hotlink pelo `/api/hls` (com Referer). O Safari recebe um MP4
  progressivo `hvc1` Main10 com suporte a Range; o 4K continua a primeira
  escolha. O 1080p H.264 dublado segue como reserva.
- **APK Android:** quando a fonte escolhida tem largura > 1920 e Referer, o
  `qualityPlayback` passa pelo `serverPlayback` (`transporte=servidor`) e
  entrega o mesmo proxy `/api/hls` ao WebView. Isso vale para celular e TV.
  Em aparelho com decodificador HEVC Main10 o 4K toca; sem ele, o fallback
  1080p entra — o aparelho precisa suportar 4K HEVC.
- **Testes:** `fontes-motor` + `playback` + `avaliador` = **123/123**; build e
  lint dos APKs ok.
- **Publicado:** release **2.13.116** (versionCode **446**) para celular, TV e
  EXE; Oracle `d7c7ca28cc69` **healthy**; feed `latest.json` 446.

O 4K é 7 GB: em rede lenta o 1080p H.264 (3 GB) pode entrar pela reserva de
12 s. A prioridade de qualidade e dublado não mudou.
