---
title: Conecta TV
emoji: 📺
colorFrom: red
colorTo: gray
sdk: docker
app_port: 3000
pinned: false
---

# Conecta TV (servidor na nuvem)

Este Space roda o aplicativo Conecta TV (o mesmo do computador) num endereço
fixo, grátis e sem cartão de crédito.

## Antes de subir — configure os segredos

No Space: **Settings → Variables and secrets → New secret** (tipo *Secret*):

| Nome | Valor |
| --- | --- |
| `ACESSO_CODIGO` | o código que libera o aplicativo (8+ caracteres) |
| `CENTRAL_KEY` | a chave do painel da central (8+ caracteres) |
| `CENTRAL_TOKEN` | o mesmo token usado para reportar na central |

Opcionais:

| Nome | Para que serve |
| --- | --- |
| `GROQ_API_KEY` | liga o Jarvis (assistente de IA) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | sincroniza favoritos e histórico |

## Depois de subir

- Aplicativo: `https://SEU-USUARIO-NOME-DO-SPACE.hf.space`
- Central: acrescente `/central` ... — a central tem aplicativo próprio; neste
  Space o foco é o Conecta TV.

O primeiro acesso pede o código (o aparelho fica autorizado por 6 meses).

## Limites honestos do plano grátis

- O Space **hiberna** depois de um tempo sem uso; a próxima abertura demora uns
  30 a 60 segundos para acordar.
- O disco é **temporário**: se o Space reiniciar, os aparelhos autorizados
  precisam informar o código de novo (os dados da central não são afetados,
  porque ela guarda no volume do computador).
- Uso "razoável" de banda: dá para a família assistir, não para distribuir.
