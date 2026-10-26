# Opção Dublado fora do anime — 2.13.123

**Data:** 26/10/2026 · **Produção:** Oracle (`https://147.15.28.222`)

## Sintoma

Na série **Tulsa King**, no APK, a imagem abria em alta definição (1080p) com
legenda em português. Quem assiste queria "tirar a legenda" — isto é, pedir a
versão **dublada** — e respondeu que *"não tem a opção"*.

## O que a Oracle entrega

| Temporada | Fonte | Resolução | Áudio |
|---|---|---|---|
| T1 | FenixFlix (FenixHub) | 720p | `pt-BR` |
| T2 | FenixFlix · dublado (HLS) | 720p | `pt-BR` |
| T3–T4 | FrostStream · dublado | 1080p | `pt-BR` |

Todas dubladas, `legendas: []`, `legendaPortugues: false`. Os arquivos
conferidos no `ffprobe` têm **só vídeo H.264 e áudio AAC `por`** — não existe
faixa de legenda separada, nem texto gravado na imagem (10 capturas por
temporada, inclusive nos minutos finais). Ou seja: nada ali é uma legenda
desativável, e nada foi reduzido de qualidade.

## A causa no aplicativo

O botão **Dublado** (o que pede de novo a versão dublada quando a fonte abriu
no áudio original) ficava dentro de `<div class="anime-audio-options">`, e o
CSS escondia essa caixa fora do modo anime:

```css
#player .anime-audio-options{display:none}
#player.anime-mode .anime-audio-options{display:block}
```

Para uma série comum isso significava: quando a abertura caía no áudio
original (regra 3 do projeto — "alta definição com legenda em português"), as
Opções **não mostravam nenhum caminho de volta para o dublado**. Era
literalmente a ausência da opção.

## A correção

- `atualizarBotaoDublado()` calcula se o título está **pendente de dublado**
  (filme ou série, fora do anime, tocando com áudio que não é português) e
  liga a classe `dublado-pendente` no player.
- O CSS dessa classe mostra a caixa de idioma mesmo sem `anime-mode`; o rótulo
  passa a "Idioma" e o botão fica visível só quando faz sentido.
- A classe é limpa ao fechar o player.
- O aviso na tela passa a dizer o caminho: *"Dublado indisponível · legenda em
  português · Opções › Dublado"*.
- O modo anime continua igual: par Legendado/Dublado sempre presente.

## Validação

- 385 testes aprovados (`node --test *.test.cjs`), incluindo um novo que exige
  a regra de CSS e o estado `dublado-pendente` nas duas cópias da interface
  (web e APK).
- Interface real aberta no Chrome, simulando o áudio original: a caixa de
  idioma aparece (`display:block`), o botão Dublado fica visível e clicável;
  com áudio dublado, some de novo.
- APK 2.13.123 (celular e TV) compilado, `assemble` + `lint` aprovados,
  publicado com o manifesto conferido (`versionCode 453`).
- Oracle republicada e verificada (`fb93c6497019`): a página servida já traz a
  correção.
