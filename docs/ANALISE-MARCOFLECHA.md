# Análise — MarcoFlecha (`marcoflecha.com`) · Quem Ama Cuida 1x20

**Pergunta:** usar o caçador da central para extrair o fornecedor
`https://marcoflecha.com/serie/quem-ama-cuida/temporada-1/episodio-20` e ver se ele
pode entrar no aplicativo dentro das regras do projeto.

**Resposta curta:** **não pode.** O MarcoFlecha não entrega vídeo: ele é um
agregador que devolve endereços de players de terceiros. Dos quatro canais que
ele oferece para este episódio, um está sem o vídeo ("Video not found"), dois
exigem verificação humana (Cloudflare Turnstile) e o quarto é legendado, cheio de
rastreadores de anúncio. O caçador mediu **nota 0** e a decisão oficial é
**descartar**. Além disso, **o episódio já toca no aplicativo** em 1080p dublado
pela fonte Fenix — o link não acrescenta nada.

Data da medição: 25/10/2026 · projeto `stream tv` v2.13.113 (Conecta TV).

---

## 1. Como o projeto funciona (o que foi estudado)

- **Aplicativo:** `server.js` + `fontes-motor.js` escolhem a fonte; `playback.js` e
  o app Android consomem o endereço de mídia. Nenhuma tela pergunta fonte ao
  usuário.
- **Regras de reprodução** (`docs/regras-reproducao.md`):
  - ausência de anúncios é **obrigatória** — "Publicidade nunca é aceita como
    solução, independentemente de idioma ou qualidade";
  - prioridade: A) Full HD+ dublado sem anúncio → B) HD dublado → C) qualidade
    inferior dublada → D) original sem anúncio;
  - "não carregar páginas ou scripts de fornecedores no player" — o app lê o
    endereço de mídia, não abre a página do fornecedor.
- **Caçador** (`central/cacador.js`): testa candidatas por categoria com o mesmo
  motor do app, reproduz no Chrome escondido e ouve o áudio. Régua:
  `dublado (3) + sem anúncio (2) + qualidade (2) + sucesso (2) + velocidade (1)`,
  com `PADRAO_APP = { alturaMinima: 720, taxaSucesso: 50, taxaDublado: 50,
  notaMinima: 7, notaSegundaOpcao: 4 }`.
  - `varredor.js` detecta redes de anúncio no HTML;
  - `verificar-navegador.js` (`tocarNoNavegador`, `espionarPagina`) reproduz e
    espiona a rede;
  - `verificar-midia.js` (`sondagemRapida`) lê faixas de áudio/vídeo com ffprobe;
  - `descobrirFicha` tenta transformar uma página em fonte (acha `.m3u8`/`.mp4`
    na página ou no iframe do player);
  - `conferirCandidata` classifica a página: anúncio → **descartada**.

## 2. O que o MarcoFlecha realmente entrega

A página do episódio (36.386 bytes) hospeda um player "SuperCDN" em
`/__x/0/tvshow/306956/1/20`. O vídeo não está no HTML: ele é montado por
JavaScript e a URL final vem **codificada em base64** de uma API interna.

Fluxo extraído (reproduzido fora do navegador):

1. `POST https://marcoflecha.com/__x/0/api` com `action=getOptions&contentid=245272`
   → quatro opções (três `type=1` dubladas, uma `type=2` legendada).
2. `POST` com `action=getPlayer&video_id=<id>` → `data.video_url` em base64.
3. Decodificado:

| Canal | Idioma | Provedor real | Situação medida |
|---|---|---|---|
| 1 (1052907) | Dublado | `vaiquecol.com/embed2/306956-1-20` | HTTP 200, mas página **"Video not found."** (1.357 bytes) |
| 2 (1052908) | Dublado | `superflixapi.fun/serie/306956/1/20#noEpList` | **Cloudflare Turnstile** (verificação humana) |
| 3 (1052909) | Dublado | `streambetter.lol/serie/306956/1/20?key=sb_pk_…` | **Cloudflare Turnstile** (verificação humana) |
| 4 (1052910) | Legendado | `vidsrc.sh/embed/tv/306956/1/20` | Anúncios/rastreadores; `data.vidsrc.sh` responde **403 invalid api token** |

O mesmo painel de quatro provedores se repete em outro título testado
(*The Last of Us* 1x1) e em filme (*A Origem*: Vaiquecol, SuperFlix,
StreamBetter, VidSrc). Ou seja: **o MarcoFlecha não tem CDN própria**; ele apenas
repassa esses quatro.

## 3. Medições do caçador

### 3.1 Anúncio na página

`central/varredor.js → sinaisDeAnuncio()` na página do episódio:
`["popup automático"]`.

Conferência manual do que existe na página:

- banner flutuante de aposta carregado de `suaveyou.com` (imagens
  `boas.png`/`aj.png`) apontando para `58sorte.com` e `189aj.vip`;
- o espião do caçador registrou o download dessas imagens na abertura
  (`suaveyou.com/ydssx-img/aj.png` e `boas.png`);
- código de pop-up em clique (`window.open`) para `58sorte.com`/`189aj.vip`
  — hoje desativado por `MAX_PER_DAY = 0`, mas o banner continua ativo.

Nuance importante: `58sorte.com`, `189aj.vip` e `suaveyou.com` **não** estão na
lista fixa de redes do `varredor.js`. Quem dispara o alerta é o padrão de pop-up
(`window.open` + texto de anúncio) — o banner foi confirmado à parte pelo espião.
Vale acrescentar esses domínios à lista (ver §6).

Pela tabela de decisão do caçador (`conferirCandidata`): página com anúncio →
**descartada** ("não atende a regra do app").

### 3.2 Espionagem dos seis endereços (18 s cada)

`central/verificar-navegador.js → espionarPagina()`:

| Alvo | Vídeo (`.m3u8`/`.mp4`) capturado | Observação |
|---|---|---|
| Página do episódio | **nenhum** | banner de aposta carregado; player só por JS |
| Player interno `/__x/0/…` | **nenhum** | JW Player 8.18; `POST /__x/0/api`; nenhuma mídia |
| Canal 1 — Vaiquecol | **nenhum** | página de erro "Video not found." |
| Canal 2 — SuperFlix | **nenhum** | só o desafio `challenges.cloudflare.com/turnstile` |
| Canal 3 — StreamBetter | **nenhum** | só o desafio `challenges.cloudflare.com/turnstile` |
| Canal 4 — VidSrc | **nenhum** | `histats`, `dtscout`, `tynt`, `mrktmtrcs`, `secutorlunts.cfd`, `…qpon`; API 403 |

### 3.3 Extratores do caçador

`acharVideoNaPagina()` e `acharPlayerNaPagina()` — executados no HTML da página,
do player interno, do Vaiquecol, do SuperFlix, do StreamBetter e do VidSrc:
**nenhum endereço de vídeo e nenhum iframe de player aproveitável.**

### 3.4 Decisão oficial

```
notaDoFornecedor([])  → nota 0 · testes 0 · sucesso 0
avaliarPromocao(...)  → { decisao: "descartar",
                          motivo: "página com anúncio (popup automático) —
                                   não atende a regra do app" }
```

## 4. Checklist contra as regras do app

| Regra | MarcoFlecha |
|---|---|
| Vídeo entregue direto ao app (`.m3u8`/`.mp4`) | **Não** — só páginas de embed |
| Sem anúncio | **Não** — banner de aposta + código de pop-up; VidSrc com rastreadores |
| Sem verificação humana | **Não** — Turnstile nos dois canais dublados que funcionam |
| Dublado em português | **Não comprovado** — canal dublado 1 está sem vídeo; 2 e 3 bloqueados; canal 4 é legendado |
| HD/FHD (≥720p) | **Não medido** — nenhum vídeo chegou a tocar |
| Não abrir página/script de terceiro no player | **Não** — a única forma de chegar ao vídeo é abrir os players embutidos |

**Conclusão: reprovado em todos os critérios que o app exige.**

## 5. O episódio já toca no app (sem o MarcoFlecha)

Rodando o motor real do app para `tmdb 306956 · temporada 1 · episódio 20`:

- `motor.escolher('dublado', alvo)` → **`fenix`** em 3,3 s:
  `FenixFlix · 1080p (conversão)`, `audio: pt-BR`, `resolucao: 1080p`.
  O arquivo foi aberto com o ffprobe do próprio caçador:
  **H.264 1920×1080, áudio AAC `por`, duração 1800,6 s (~30 min)**,
  ~419 MB, MP4 direto — sem playlist de anúncio.
- `mgeb` → HLS VOD 720p, sem marcadores de anúncio (`DATERANGE`/`SCTE`),
  áudio não declarado na playlist.
- `fenixflix-fenixhub` → MP4 720p, mas a faixa de áudio medida é **`eng`**
  (o perfil declara `dublado: true`/`1080p`) — divergência que merece correção,
  embora o motor prefira o `fenix` (1080p/português) neste título.
- No momento da medição: `watchplay` 404, `pipoca-serie` sem resposta,
  `clickhost` sem resposta, `vixsrc` 404, `vidsrc` 403, `vidlink-direto` sem
  resposta — o título continua coberto por Fenix/MGEB.

## 6. Achados colaterais (para a manutenção)

1. **`vidsrc-source.js` está quebrado:** `https://data.vidsrc.sh/api.php` agora
   responde `403 {"error":"invalid api token"}` — inclusive com os parâmetros que
   o adaptador usa. Resultado: `vidsrc` = "sem resposta" no motor.
2. **Perfil `fenixflix-fenixhub`:** para este episódio o arquivo entregue é
   720p com áudio `eng`, enquanto o perfil declara `dublado: true` e `1080p`.
   O motor não é enganado porque o `fenix` vence na fila, mas se o `fenix` falhar
   o app pode cair nesse arquivo em inglês.
3. **Lista de anúncios do varredor:** `58sorte.com`, `189aj.vip` e
   `suaveyou.com` não estão em `REDES_DE_ANUNCIO`; só o padrão de pop-up pegou o
   MarcoFlecha. Incluir esses domínios deixa a detecção de banner mais direta.

## 7. Se ainda quiser aproveitar algo do MarcoFlecha

- **Como fonte:** não. Não há mídia direta, e os canais úteis estão atrás de
  Turnstile. Contornar a verificação violaria a regra de não carregar páginas/
  scripts de fornecedor e a própria proteção do site.
- **Como radar de catálogo:** tecnicamente possível ler `getOptions`/`getPlayer`
  para descobrir *quais provedores têm o título* — mas o painel é sempre
  Vaiquecol, SuperFlix, StreamBetter e VidSrc, que o projeto já conhece
  (`central/cacador.js` já lista SuperFlix e StreamBetter como "verificação e
  anúncio"). Não traz fornecedor novo.
- **O único componente com potencial** é o **Vaiquecol** (canal 1), que já é usado
  na exceção Crystal Lake com validação estrita. Mas para *Quem Ama Cuida* 1x20
  ele responde "Video not found"; uma integração geral exigiria um adaptador
  próprio (mesma validação de configuração/playlist/segmentos), não uma
  integração com o MarcoFlecha.

## 8. Como reproduzir

```bash
# 1. Opções e players do MarcoFlecha (base64 → provedores)
curl -sS -X POST https://marcoflecha.com/__x/0/api \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Referer: https://marcoflecha.com/__x/0/tvshow/306956/1/20' \
  --data 'action=getOptions&contentid=245272'
# depois: --data 'action=getPlayer&video_id=1052907' (e 1052908/1052909/1052910)

# 2. Decisão do caçador
node -e "const c=require('./central/cacador'),v=require('./central/varredor'),fs=require('fs');
const h=fs.readFileSync('pagina.html','utf8');
console.log(v.sinaisDeAnuncio(h), c.acharVideoNaPagina(h));"

# 3. Espionagem (abre Chrome escondido e ouve a rede)
node -e "require('./central/verificar-navegador')
  .espionarPagina('https://marcoflecha.com/__x/0/tvshow/306956/1/20',{segundos:18})
  .then(r=>console.log(r.videos,r.pedidos.filter(p=>p.includes('m3u8'))))"

# 4. O que o app já entrega para este episódio
node -e "const m=require('./fontes-motor');
m.escolher('dublado',{tipo:'tv',tmdbId:'306956',temporada:'1',episodio:'20'})
 .then(r=>console.log(r.fonte,r.audio,r.resolucao))"
```
