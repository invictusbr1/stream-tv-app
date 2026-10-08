# Hospedar no Hugging Face Spaces — passo a passo

## Nível de dificuldade: baixo

São 4 passos e nenhum deles pede cartão. O que dá trabalho é a **primeira
publicação** (uns 5 a 10 minutos, contando a construção da imagem). Depois, se
quiser, dá para automatizar as atualizações com um fluxo do GitHub (arquivo já
incluído em `.github/workflows/publicar-huggingface.yml`).

## Passo 1 — Conta

Crie a conta em <https://huggingface.co> (entra com Google, GitHub ou e-mail).
Depois, em **Settings → Access Tokens**, crie um token com permissão de
**write** e guarde (é a senha que o script usa para enviar os arquivos).

## Passo 2 — Criar o Space

1. <https://huggingface.co/new-space>
2. Nome: `conecta-tv`
3. License: pode deixar em branco
4. **Space SDK: Docker** → template **Blank**
5. Hardware: **CPU basic (free)**
6. Visibility: **Private** (recomendado) ou Public

## Passo 3 — Segredos

No Space: **Settings → Variables and secrets → New secret** (tipo *Secret*):

| Nome | O que colocar |
| --- | --- |
| `ACESSO_CODIGO` | o código que libera o aplicativo (8+ caracteres) |
| `CENTRAL_KEY` | a chave do painel da central |
| `CENTRAL_TOKEN` | o mesmo token que o app usa para reportar |

Opcionais: `GROQ_API_KEY` (Jarvis), `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

## Passo 4 — Enviar os arquivos

No seu computador:

```powershell
pwsh -File "C:\Users\tikto\OneDrive\Área de Trabalho\stream tv\deploy\huggingface\Publicar-No-HuggingFace.ps1" -Space SEU-USUARIO/conecta-tv
```

Na primeira vez o Git vai pedir usuário e senha: use o **seu usuário do Hugging
Face** e, como senha, **o token** criado no passo 1.

Depois disso, acompanhe em `https://huggingface.co/spaces/SEU-USUARIO/conecta-tv`
(aba **Logs**). Quando aparecer “Running”, o endereço é:

```
https://SEU-USUARIO-conecta-tv.hf.space
```

## Atualizações automáticas (opcional, mas vale)

O projeto já tem o fluxo `.github/workflows/publicar-huggingface.yml`. Para
ativar:

1. No GitHub, em `invictusbr1/stream-tv-app` → **Settings → Secrets and
   variables → Actions**:
   - *Secrets*: `HF_TOKEN` (o token do Hugging Face)
   - *Variables*: `HF_SPACE` = `SEU-USUARIO/conecta-tv`
2. Em **Actions**, rode “Publicar no Hugging Face” uma vez (ou faça qualquer
   commit): a partir daí, cada envio para o `main` atualiza o Space sozinho.

## As pegadinhas (importante saber antes)

| Ponto | O que acontece | Como conviver |
| --- | --- | --- |
| **Disco temporário** | Se o Space reiniciar ou for reconstruído, os aparelhos autorizados precisam informar o código de novo | O código continua o mesmo; é só digitar outra vez |
| **Hibernação** | Space free dorme depois de um tempo parado (48 h por padrão, ajustável nas configurações) | A primeira abertura demora 30–60 s |
| **Banda** | Não há limite publicado, mas é uso “razoável” — serve para a família, não para distribuir | Para muitos espectadores, use um servidor próprio |
| **Regras do serviço** | Spaces são para aplicativos e demonstrações; uso como proxy de vídeo pode ser questionado | Se cair, o mesmo pacote Docker sobe em outro lugar |
| **Uma porta só** | O Space expõe apenas a porta do `app_port` | Já configurado: 3000. A central fica melhor no seu PC |

## Vale a pena?

- **Sim**, se você quer um endereço fixo de graça e sem cartão, com o PC
  desligado.
- **Não**, se o objetivo é o máximo de banda e zero risco de suspensão — nesse
  caso o melhor continua sendo o **Tailscale Funnel** (endereço fixo, sem
  terceiros) ou um servidor próprio com domínio.
