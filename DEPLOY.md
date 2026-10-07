# Como hospedar o Conecta TV (e a central) de graça

## Onde cada coisa roda (o desenho recomendado)

São dois programas, com necessidades diferentes:

| Programa | O que ele faz | Onde faz sentido rodar |
| --- | --- | --- |
| **Conecta TV** | busca a fonte do filme/série, encaminha o vídeo, guarda favoritos | **no seu computador** (é onde já está rodando, com o túnel "Acesso pelo celular") |
| **Central** | recebe os relatos e mostra o painel de status | **no seu computador**, como programa instalado (atalho "Central Conecta TV" na Área de Trabalho) |

### Como está montado hoje (só no PC)

- Programa da central: `C:\Users\tikto\Conecta TV Central\Central Conecta TV.exe`
  (atalho na Área de Trabalho). Ao abrir, ele cria a pasta `dados` ao lado do
  programa com a chave do painel (`dados/chave.txt`) e abre o painel já logado
  em `http://localhost:4100`.
- O aplicativo Conecta TV aponta para ela pelo `config.local.json` que fica na
  pasta do próprio aplicativo: `"central": "http://127.0.0.1:4100"`.
- Resultado: cada sessão assistida no PC (ou pelo navegador/celular que use esse
  servidor) aparece no painel, sem depender de internet ou serviço de terceiros.

Usar `127.0.0.1` em vez de `localhost` evita um detalhe chato: no Windows,
`localhost` pode resolver para IPv6 e a central escuta em IPv4.

Para ver o painel no celular **na mesma rede Wi-Fi**: abra
`http://SEU-IP:4100` (o IP aparece na janela do programa) e informe a chave. Se
quiser ver **fora de casa**, aí sim vale publicar a central num serviço — o
caminho está nas opções abaixo.

## Aplicativo da central (Android)

A central também virou aplicativo:

- Fonte: `central/android/` (projeto Android próprio, ícone próprio, nome
  "Central Conecta TV").
- Compilar: `pwsh -File central/android/Build-Central.ps1 -ToolRoot <ferramentas>
  -BuildDirectory <pasta sem acento> -OutputDirectory <saída>`.
- Instalar no celular, abrir uma vez e informar **endereço da central** +
  **chave do painel**. Fica guardado; nas próximas vezes abre direto.
- Publicar atualização: `pwsh -File central/android/Publicar-Central.ps1
  -ApkPath <apk> -Notes "..."` — sobe no mesmo repositório de releases, com o
  arquivo de aviso `central.json`.

## Antes de tudo: o que a hospedagem muda

Hoje o aplicativo só existe dentro da sua rede. Hospedado, ele ganha um endereço
público — e **qualquer pessoa com o endereço consegue usar**, a menos que você
ligue o código de acesso. Por isso, a ordem certa é:

1. Definir um **código de acesso** (`ACESSO_CODIGO`) — sem ele o aplicativo fica
   aberto para o mundo.
2. Definir a **chave do painel** da central (`CENTRAL_KEY`) e o **token** que os
   aplicativos usam para reportar (`CENTRAL_TOKEN`).
3. Só então publicar o endereço.

Dois avisos honestos:

- Plano gratuito do Render **dorme** depois de ~15 minutos sem uso. O primeiro
  acesso depois disso demora uns 30 segundos para acordar. A central também
  dorme.
- Serviços gratuitos costumam ter **limite de tráfego** e podem ser suspensos se
  receberem denúncia de conteúdo. Para uso realmente pessoal, vale mais manter
  uma instância só sua (um PC ligado com o túnel, como você já usa) do que
  apostar em hospedagem pública ilimitada.

## Opção 1 — Render (mais simples, plano free)

O repositório já tem o `render.yaml` com os dois serviços prontos:
`conecta-tv` (aplicativo) e `conecta-tv-central` (painel).

1. Crie uma conta em <https://render.com> entrando com o GitHub.
2. No painel do Render: **New → Blueprint**, escolha o repositório
   `invictusbr1/stream-tv-app`.
3. O Render lê o `render.yaml` e pede os valores que estão marcados como
   `sync: false`:
   - `ACESSO_CODIGO` — o código que você vai dar para a família (ex.: uma frase
     só sua, com 12+ caracteres).
   - `CENTRAL_KEY` — a chave do painel da central.
   - `CENTRAL_TOKEN` — o mesmo valor nos dois serviços (é a senha que o
     aplicativo usa para reportar).
   - `ORIGENS_PERMITIDAS` — deixe vazio; só preencha se for abrir a API para
     outro site.
   - `GROQ_API_KEY` (opcional) — para o Jarvis responder.
4. Clique em **Apply**. Em alguns minutos o Render publica:
   - aplicativo: `https://conecta-tv-xxxx.onrender.com`
   - central: `https://conecta-tv-central-xxxx.onrender.com`
5. Abra o endereço do aplicativo, informe o código uma vez. O aparelho fica
   autorizado por 6 meses (crachá guardado no navegador).
6. Abra o endereço da central e entre com a `CENTRAL_KEY`.

## Opção 2 — rodar no seu computador e abrir pelo túnel (o que você já usa)

Nada muda no código: continue usando "Acesso pelo celular.cmd". A central roda
em paralelo:

```powershell
# janela 1 — aplicativo
$env:ACESSO_CODIGO="seu-codigo-bem-grande"; node launcher.js

# janela 2 — central
$env:CENTRAL_KEY="chave-do-painel"; node central/servidor.js
```

No aplicativo, aponte a central:

```powershell
$env:CENTRAL_URL="http://localhost:4100"
```

## Opção 3 — qualquer host com Docker

> Para servidor grátis na nuvem (Oracle Always Free, o único que aguenta vídeo
> com folga), use o pacote pronto em **`deploy/servidor/`**: ele tem o
> `docker-compose.yml` com aplicativo + central, o instalador de um comando
> (`Instalar-No-Servidor.sh`) e o passo a passo em `LEIA-ME-SERVIDOR.md`.
> Vantagem: com o servidor na nuvem o seu computador **não precisa ficar
> ligado**.

O projeto tem `Dockerfile` e `.dockerignore` prontos:

```bash
docker build -t conecta-tv .
docker run -p 3000:3000 -e ACESSO_CODIGO=seu-codigo -e PORT=3000 conecta-tv

docker build -t conecta-tv-central -f central/Dockerfile .
docker run -p 4100:4100 -e CENTRAL_KEY=chave-do-painel -e CENTRAL_TOKEN=mesmo-token conecta-tv-central
```

## Variáveis que importam

| Variável | Para que serve |
| --- | --- |
| `PORT` | Porta do serviço (o Render define sozinho). |
| `ACESSO_CODIGO` | Liga o portão de entrada do aplicativo. Sem ela, fica aberto. |
| `CENTRAL_URL` | Endereço da central que recebe os relatos. |
| `CENTRAL_TOKEN` | Senha que o aplicativo usa para reportar na central. |
| `CENTRAL_KEY` | Chave do painel da central. |
| `ORIGENS_PERMITIDAS` | Lista de sites autorizados a chamar a API (separados por vírgula). |
| `LIMITE_PEDIDOS` / `LIMITE_MIDIA` | Teto de pedidos por minuto (API / vídeo). |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | Chaves do Jarvis (opcionais). |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Sincronização de favoritos e histórico (opcional). |

## Depois de publicado

- Para o APK Android falar com o servidor hospedado, o próprio aplicativo usa o
  servidor local do aparelho; se quiser que ele use o servidor da nuvem, defina
  o endereço no `config.json` do APK (variável de build).
- Guarde `ACESSO_CODIGO`, `CENTRAL_KEY` e `CENTRAL_TOKEN` como senhas. Quem
  tiver o código entra; quem tiver a chave vê o painel.
