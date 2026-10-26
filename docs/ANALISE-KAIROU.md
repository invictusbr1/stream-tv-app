# Kairou + FrostStream — cobrindo os episódios que faltavam

**Pergunta:** o Kairou (`https://kairou.space/`) consegue suprir os episódios
121+ de *Quem Ama Cuida* (TMDB 306956) que ficaram sem fonte?

**Resposta curta:** **sim, de 121 a 136.** O Kairou usa o addon **FrostStream**
(121–135) e o provedor **VeTela**, via API do Kairou, para o **136** — MP4
1080p, áudio em português, sem anúncio. O app passou a usar os dois.
**137 a 142 são episódios futuros** (o 137 vai ao ar em 26/10), então ainda não
há fonte publicada — não é falha de fonte.

Medido em 25/10/2026.

---

## 1. O que é o Kairou

É um site agregador (React + TMDB + Supabase) que não hospeda vídeo: ele consulta
provedores e monta a lista de players. Lendo o bundle (`/assets/index-*.js`),
os provedores usados são:

| Provedor | O que é | Já estava no app? |
|---|---|---|
| **ClickHost** (`embed-api.clickhost.xyz`) | arquivo/lista direto | sim (`clickhost-source.js`) |
| **MGEB** (`mgeb.site`) | HTML com `sources` | sim (`mgeb-source.js`) |
| **FrostStream** (`froststream.cloutteam.com`) | addon JSON com MP4/HLS | **não — entrou agora** |
| KingVod / SuperStream (baby-beamup) | addons Stremio | vazios para este título |
| FenixTV / ReidoEmbeds | TV ao vivo/esportes | não se aplica a novela |

A página do Kairou tem monetização própria (ProfitOn) no bundle, mas **o app não
abre a página**: o adaptador lê o addon e entrega só o arquivo de vídeo ao
player.

## 2. O addon FrostStream (o que foi extraído)

```
GET https://froststream.cloutteam.com/stream/series/tt42751057:1:121.json
```

Resposta (resumida):

```json
{"streams":[{
  "name":"FrostStream 1080p",
  "title":"🎬 Quem Ama Cuida 2026 (2026)\n🥏 T01·E121\n🌊 Carbon\n🌎 Português",
  "url":"https://froststream.cloutteam.com/series/v1.…",
  "behaviorHints":{"bingeGroup":"cloutstream-cs:series:quem-ama-cuida-2026-2026"}
}]}
```

O título traz `T01·E121` e a fonte é MP4 progressivo. Quando o episódio **não
existe**, o addon devolve o **MegaEmbed do episódio 1** (HLS 720p, 3590 s) com o
título do episódio pedido — é o mesmo truque da MGEB. O adaptador recusa esse
fallback por três sinais: `MegaEmbed` no título/`bingeGroup`, headers
`Origin/Referer` de `megaembed.com` e endereço `.m3u8`.

## 3. Cobertura medida (118 a 142)

| Episódios | Provedor | Duração | Qualidade | Áudio |
|---|---|---|---|---|
| 118–120 | FrostStream (MP4) | 2069–3364 s | 1920×1080 | `por` |
| **121–133** | FrostStream (MP4) | 1184–3193 s | 1920×1080 | `por` |
| **134** | FrostStream (MP4) | 1290 s | 1920×1080 | `por` |
| **135** | FrostStream (MP4) | 2974 s | 1920×1080 | `por` |
| **136** | **VeTela (via Kairou)** | **3077 s** | **1920×1080** | **`por`** |
| 137–142 | futuros (137 em 26/10) | — | — | — |

Os episódios 118–120 já eram cobertos por outras fontes; a novidade é
**121–136**. O 134 apareceu no addon depois da primeira varredura (estava vazio).
O **136** veio do **VeTela**, o mesmo provedor que o Kairou usa no player dele:
MP4 1080p, áudio `por`, **3077 s (51 min)** — o runtime do TMDB para o 136 é
51 min. O Kairou lista também o fallback FrostStream/MegaEmbed (episódio 1),
que é ignorado.

## 4. Teste nas regras do app

Ferramentas do caçador no MP4 do 121:

- `sondagemRapida`: `container: mov,mp4`, **altura 1080**, `idiomas: ["por"]`,
  `dublado: true` — "faixa de áudio em português (padrão do arquivo)";
- `tocarNoNavegador`: **`tocou: true`, 1080p, 2528 ms, `popups: []`,
  `anuncios: []`**;
- arquivo direto (`type: file`), sem playlist de anúncio, sem abrir página.

Atende à regra: dublado, sem anúncio, HD, direto ao player.

## 5. O que foi implementado

1. **`froststream-source.js`**: resolve IMDb no TMDB, consulta o addon, filtra
   pelo marcador do episódio e recusa o fallback MegaEmbed; devolve MP4 direto
   com `audio: pt-BR`, `resolucao` do rótulo, `type: file`, `final: true`.
2. **`fontes-motor.js`**: fonte `froststream`, papel `dublado`, **peso 94**
   (depois da Fenix e antes do ClickHost/MGEB). Ela só é usada quando as
   anteriores não entregam.
3. **`kairou-source.js`**: consulta `https://www.kairou.space/api/extract` com
   `tmdbId`, `type`, `season` e `episode`; só aceita streams `isVeTela` (o
   fallback FrostStream/MegaEmbed é ignorado); devolve MP4 direto com
   `audio: pt-BR` e `resolucao` 1080p.
4. **`fontes-motor.js`**: fonte `kairou`, papel dublado, **peso 80** — última
   opção dublada, depois de FrostStream/MGEB/Fenix.
5. **`mgeb-source.js`**: guard do `<title>`/`vod_nao_encontrado` da correção
   anterior.
6. **Android nativo**: `qualityMgebSource` confere o `<title>` e recusa
   episódio errado/`vod_nao_encontrado`. Sem isso o celular/TV continuaria
   tocando o 1.
7. **Testes**: `kairou-source.test.cjs` (5 casos), `froststream-source.test.cjs`
   (7), `mgeb-source`/`fontes-motor`/`avaliador` — **45 passando**.

## 6. Publicado

- **Produção**: **Oracle**, `https://147.15.28.222` — é esse endereço que o app
  lê no GitHub Pages. A versão `ae3b8680a5e5` foi publicada em 25/10 18:17 UTC
  com `deploy/servidor/publicar-automatico.cjs --once`; o publicador confirmou
  "versão publicada e verificada".
- **Conferido na Oracle**:
  - EP 1: Fenix 1080p; EP 20: FrostStream 1080p;
  - EP 121: FrostStream 1080p; EP 136: Kairou/VeTela 1080p.
- **Servidor local desativado** (pedido): `Conecta TV.exe` e
  `Manter-Online.ps1` parados, porta 3000 livre; atalhos de inicialização
  movidos para `C:\Users\tikto\Conecta TV\startup-desativado`
  (`Conecta TV - Manter Online.cmd`, `Conecta TV Servidor.lnk`). Para reativar,
  devolva os dois para a pasta Startup. O PC não serve mais o app; a Oracle é a
  produção.
- **APKs/release**: `Conecta-TV-Android-2.13.114.apk`,
  `Conecta-TV-TV-2.13.114.apk`, tag **v2.13.114**, `latest.json` 444. O EXE
  local fica só como backup/rollback; não é mais necessário para o app.

## 7. O que continua faltando

**137 a 142** — todos **futuros**: air dates 26/10 a 31/10 no TMDB. Não é
falha de fonte; ainda não existe capítulo publicado para eles. O 137 vai ao ar
em 26/10. Quando a FrostStream/VeTela publicarem, o adaptador pega sozinho (cache
de 3–20 min), sem nova alteração. O caçador da central continua procurando em
paralelo.

## 8. Como reproduzir

```bash
# cobertura do addon
curl -sS 'https://froststream.cloutteam.com/stream/series/tt42751057:1:121.json'
curl -sS 'https://froststream.cloutteam.com/stream/series/tt42751057:1:136.json'
# o 136 vem do VeTela via Kairou:
curl -sS -H 'Accept: application/json' \
  'https://www.kairou.space/api/extract?type=series&season=1&episode=136&tmdbId=306956'

# o que o app entrega
# produção é a Oracle (o servidor local foi desativado)
CODIGO=$(curl -sS 'https://invictusbr1.github.io/stream-tv-app/endereco.json' \
  | python -c "import sys,json;print(json.load(sys.stdin)['codigo'])")
curl -skS -H 'Accept: application/json' \
  "https://147.15.28.222/api/playback/serie/306956/1/121?codigo=$CODIGO"
curl -skS -H 'Accept: application/json' \
  "https://147.15.28.222/api/playback/serie/306956/1/136?codigo=$CODIGO"

# testes da fonte
node --test kairou-source.test.cjs froststream-source.test.cjs mgeb-source.test.cjs
```
