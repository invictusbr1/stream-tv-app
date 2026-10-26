# Bug — "Quem Ama Cuida": episódios a partir do 121 tocavam o episódio 1

**Sintoma:** na série/novela *Quem Ama Cuida* (TMDB 306956), os episódios mais
recentes abriam com o **mesmo vídeo do episódio 1**.

**Causa:** a fonte MGEB, usada como segunda opção dublada, devolve a página do
**episódio 1** quando o episódio pedido não existe no catálogo dela. A página
declara isso no próprio `<title>` e o app não conferia. A fonte principal (Fenix)
não tem esses episódios, então o motor caía na MGEB e tocava o arquivo errado.

**Correção:** o adaptador da MGEB agora lê o `<title>` da página e recusa quando
o episódio declarado não é o pedido; também recusa o MP4 de fachada
`vod_nao_encontrado.mp4`. Quando nenhuma fonte tem o episódio, o app mostra
"nenhuma fonte sem anúncio tem este episódio ainda" em vez de tocar o errado.

---

## 1. O que foi medido (25/10/2026)

### MGEB — a página declara o episódio no título

| Episódio pedido | `<title>` devolvido | Arquivo entregue | Duração |
|---|---|---|---|
| 1 | `Quem Ama Cuida - T1E1 - Capítulo 1` | `20e977bc…/d0376cc5…` | 3590,09 s |
| 2 | `Quem Ama Cuida - T1E2 - Capítulo 2` | `6033b5c2…/163f20d8…` | 3313,77 s |
| 20 | `Quem Ama Cuida - T1E20 - Capítulo 20` | `10ccad96…/fc76230d…` | 1800,63 s |
| 120 | `Quem Ama Cuida - T1E120 - Episódio 120` | `vod_nao_encontrado.mp4` (fachada) | 0 s |
| **121** | **`Quem Ama Cuida - T1E1 - Capítulo 1`** | **o mesmo do episódio 1** | **3590,09 s** |
| **136** | **`Quem Ama Cuida - T1E1 - Capítulo 1`** | **o mesmo do episódio 1** | **3590,09 s** |
| 142 | `Quem Ama Cuida - T1E1 - Capítulo 1` | o mesmo do episódio 1 | 3590,09 s |

A fronteira medida: **até o 120 a MGEB tem o episódio certo; do 121 em diante
ela devolve o episódio 1**. No 120 ela devolve um MP4 de "não encontrado".

### O que o servidor entregava ao app antes da correção

Pedido `GET /api/playback/serie/306956/1/136`:

```json
{
  "url": "https://www-fontedecanais-live.77zzhf54vdll71.com/series/quem%20ama%20cuida/378737.mp4?...",
  "audio": "pt-BR",
  "source": "MGEB · dublado",
  "fonteId": "mgeb",
  "type": "file"
}
```

O ffprobe desse arquivo: **3590,087 s / 874.935.311 bytes** — exatamente o
arquivo do episódio 1. Ou seja, o app pedia 136 e recebia 1.

### Fenix (fonte principal)

- Episódios 1, 2, 20 e 50: arquivos distintos, áudio `por`, 1080p.
- Até ~100: MP4 de conversão disponível.
- 110–121: só o stream `FenixHub` (720p/1080p), com o título certo (`T01 EP120`).
- 122+: só um link do YouTube (não é vídeo do título) ou lista vazia.
- 136: lista vazia.

Por isso o motor caía na MGEB justamente nos episódios mais novos.

## 2. A correção (`mgeb-source.js`)

- `episodioDoTitulo(html)` lê `T1E136`/`T01E01`/`2x7` do `<title>`.
- Em `resolverTodos`, se a página for de série e o título declarar outro
  episódio, devolve `[]` (o motor tenta a próxima fonte).
- `ehNaoEncontrado()` recusa `vod_nao_encontrado.mp4` em `limparEndereco()` e na
  leitura da página.
- Sem título reconhecível, o comportamento antigo é mantido (não quebra fontes
  que não declaram episódio).

Testes novos em `mgeb-source.test.cjs`:

- título declara temporada/episódio;
- página do 136 com título do 1 → recusada;
- página do 136 com título do 136 → aceita;
- MP4 "não encontrado" → recusado.

Resultado da suíte: **65 testes, 65 passando** (`mgeb-source`, `fontes-motor`,
`avaliador`).

## 3. Publicação feita

O servidor em produção era o **EXE compilado** `C:\Users\tikto\Conecta TV\Conecta TV.exe`
(compilado em 12/10/2026), não o código-fonte. A correção foi compilada e o EXE
trocado:

- build: `dist/Conecta TV.teste.exe` (120.098.517 bytes);
- backup do anterior: `C:\Users\tikto\Conecta TV\Conecta TV.exe.bak-20261025`;
- EXE novo no lugar, servidor reiniciado (PID 17692), `/api/health` = `ok`;
- login por crachá de aparelho continua funcionando (200).

## 4. Comportamento depois da correção (medido em produção)

| Episódio | Resultado |
|---|---|
| 1 | FenixHub 1080p, dublado — abre |
| 120 | ClickHost 1080p, dublado — abre |
| 121–124 | "Nenhuma fonte sem anúncio tem este episódio ainda" |
| 125, 136, 142 | mesma mensagem |

Ou seja: **não toca mais o episódio errado**. Os episódios 121+ ainda não têm
fonte limpa publicada; o app avisa e o caçador continua procurando. Quando
aparecer uma fonte, o episódio abre sozinho.

> Observação: o TMDB hoje lista **142** episódios (o app mostra todos). Antes a
> lista tinha 136; o número muda conforme a novela avança.

## 5. Como reproduzir/verificar

```bash
# título que a MGEB devolve para cada episódio
for ep in 120 121 136 142; do
  curl -sSL -A 'Mozilla/5.0' -e 'https://mgeb.site/' \
    "https://mgeb.site/embed/306956/1/$ep" | grep -o -m1 '<title>[^<]*'
done

# o que o app recebe (com o código local)
curl -sS -H 'Accept: application/json' \
  'http://127.0.0.1:3000/api/playback/serie/306956/1/136?codigo=conecta-2007'

# testes da correção
node --test mgeb-source.test.cjs
```

## 6. Se quiser voltar ao EXE anterior

O backup está em
`C:\Users\tikto\Conecta TV\Conecta TV.exe.bak-20261025`. Para restaurar: pare o
processo `Conecta TV.exe`, copie o backup por cima de `Conecta TV.exe` e abra de
novo (ou deixe o vigia `Manter-Online.ps1` reabrir).

## Atualização 25/10/2026 — versão 2.13.114

Depois da correção do guard, o Kairou foi analisado e a cobertura foi ampliada:

- **121–135**: `FrostStream` (MP4 1080p, áudio `por`) — `froststream-source.js`;
- **136**: `VeTela` via API do Kairou (MP4 1080p, `por`, 3077 s) —
  `kairou-source.js`;
- **137–142**: episódios futuros (air dates 26/10–31/10); ainda sem fonte
  publicada.

Publicado: APKs **2.13.114** (celular/TV), EXE **2.13.114**, release
**v2.13.114** e os feeds `latest.json` (versionCode 444). Análise completa em
`ANALISE-KAIROU.md`.

## Produção Oracle e desligamento do servidor local

O app lê o endereço de produção no GitHub Pages; ele aponta para a **Oracle**
(`https://147.15.28.222`). A Oracle estava com o código antigo (MGEB devolvendo
o episódio 1 no 121/136) porque o publicador estava parado desde 23/10. Em
25/10 foi publicado `ae3b8680a5e5` e conferido: **121 FrostStream 1080p** e
**136 Kairou/VeTela 1080p**.

O servidor local foi **desativado** a pedido: `Conecta TV.exe` e
`Manter-Online.ps1` parados, porta 3000 livre; atalhos de inicialização
movidos para `C:\Users\tikto\Conecta TV\startup-desativado` (devolva-os à pasta
Startup para reativar). O PC não serve mais o app; a Oracle é a produção.

## Atualização 2.13.117 — série no APK e guard do Kairou

O 121 estava caindo no **VeTela do 136** no caminho `serverPlayback` com
`codec=avc`: a API do Kairou devolve o capítulo mais recente quando não tem o
pedido, e a fonte aceitava sem conferir o episódio.

- `kairou-source.js` agora consulta o TMDB e só aceita o VeTela quando o pedido
  é o episódio mais recente já exibido; 121–135 caem no FrostStream.
- O APK 2.13.117 manda **qualquer arquivo direto com Referer** pelo
  `serverPlayback` (`/api/hls`); o WebView não consegue mandar Referer.
- Conferido na Oracle: **121 FrostStream 1080p** e **136 Kairou 1080p**, ambos
  `pt-BR` e proxiados; o caminho normal devolveu o VeTela certo de 121
  (arquivo de 06/10) e de 136 (24/10).
- Testes: **129/129** (`kairou`, `fontes-motor`, `playback`, `avaliador`); build
  e lint dos APKs ok.
- Publicado: release **2.13.117** (versionCode **447**), Oracle
  `418711b902a4` **healthy**.

## Atualização 2.13.118 — a série usa o servidor primeiro

O 2.13.117 ainda tentava as fontes nativas primeiro e só chamava o
`serverPlayback` depois; a fonte nativa falhava e o WebView ficava em
"carregando" até o "tente novamente".

- O `qualityPlayback` agora, para **série (`tv`)**, chama o `serverPlayback`
  **antes** das fontes nativas. O servidor devolve o proxy `/api/hls`
  (FrostStream no 121, Kairou no 136) e o WebView toca direto.
- O caminho nativo foi conferido com o mesmo header do APK
  (`X-Conecta-Codigo`) e `Range`: `/api/hls` responde **206 video/mp4**; o
  `/api/playback` responde 200. O problema era a ordem, não a autenticação.
- Filmes continuam com a regra anterior (4K primeiro; o 4K proxiado da
  2.13.116); a série usa o servidor primeiro.
- **Publicado:** release **2.13.118** (versionCode **448**) para celular e TV;
  Oracle `418711b902a4`; feed 448.

## Atualização 2.13.119 — o caminho normal da série

O 2.13.118 colocou o servidor primeiro no `qualityPlayback`, mas o pedido
normal de série **não passava por ele**: o `shouldInterceptRequest` chamava
`directEpisode` direto. Só o `compat=avc` usava o `qualityPlayback`; por isso a
série continuava em "carregando / tente novamente".

- O caminho normal de `/api/playback/serie/...` agora chama o `serverPlayback`
  **antes** do `directEpisode`.
- Conferido com o mesmo header do APK (`X-Conecta-Codigo`): **121 → VeTela de
  06/10/2026** (a data do 121) e **136 → VeTela de 24/10/2026** (a data do
  136), ambos 1080p `pt-BR`; `/api/hls` responde **206 video/mp4**.
- **Publicado:** release **2.13.119** (versionCode **449**) para celular e TV;
  feed 449; Oracle `418711b902a4`.

## Atualização 2.13.120 — `/api/hls` direto no WebView

Os logs da Oracle mostraram o celular (SM-S948B) pedindo `/api/hls` com
`X-Conecta-Codigo` e a conexão caindo no meio (`broken pipe` / `connection
reset`) em filme e série. O problema era o `serverMedia` nativo: o WebView
recebia o stream pelo proxy local e abortava o Range.

- O `serverPlayback` agora devolve a URL **absoluta** da Oracle
  (`https://147.15.28.222/api/hls?...&codigo=...`); o WebView toca direto, com
  o motor de mídia do Android.
- O `playback.js` libera `https://.../api/hls?` em `enderecoDeMidia`.
- Teste da URL absoluta: **206 video/mp4**, `Content-Range` correto.
- **Publicado:** release **2.13.120** (versionCode **450**) para celular e TV;
  feed 450. O 2.13.119/449 continua usando o `serverMedia` e deve ser
  atualizado.
