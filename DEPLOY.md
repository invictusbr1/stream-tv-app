# Como hospedar o Conecta TV (e a central) de graça

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
