# Central do Conecta TV — como usar

## 1. O que é

Um aplicativo separado, só de **status**. Ele não reproduz nada: recebe o que os
aparelhos contam (quem entrou, o que está assistindo, por qual fonte, qualidade,
falhas) e mostra tudo em um painel.

## 2. Onde o servidor da central roda

O painel é uma página servida por um servidor pequeno (Node). Ele precisa estar
ligado para o celular ver os dados. Três lugares possíveis:

| Onde | Prós | Contras |
| --- | --- | --- |
| **Seu computador** (`node central/servidor.js`) | grátis, dados só seus, zero configuração | só funciona com o PC ligado; na rua precisa do túnel |
| **Render (plano free)** | endereço fixo em HTTPS, sempre no ar | dorme após ~15 min sem uso (primeira abertura ~30 s) |
| **Docker/VPS** | controle total, endereço fixo | requer um servidor (Fly.io, Koyeb, Oracle Free...) |

O Conecta TV (filmes e séries) continua rodando no seu computador. A central
pode rodar junto dele ou num serviço separado — o aplicativo só precisa saber o
endereço.

## 3. Como subir

```bash
# no computador, dentro da pasta do projeto
node central/servidor.js
```

Saída esperada:

```
  Central do Conecta TV está no ar.
  Painel : http://localhost:4100
  No celular: http://192.168.x.x:4100
  Chave do painel: a que você configurou (CENTRAL_KEY)
```

Variáveis:

| Variável | Para que serve |
| --- | --- |
| `CENTRAL_KEY` | chave do painel (8+ caracteres). Sem ela, o servidor gera uma e mostra no console. |
| `CENTRAL_TOKEN` | senha que os aplicativos usam para reportar. Recomendado quando exposto na internet. |
| `CENTRAL_DADOS` | pasta onde ficam os dados (`central/dados` por padrão). Aponte para um disco permanente na hospedagem. |
| `PORT` | porta (padrão 4100). |

## 4. Aplicativo Android da central

Em `central/android/`. Compile com `Build-Central.ps1`, instale no celular e
informe, no primeiro uso, o endereço da central e a chave do painel. Depois é só
abrir.

## 5. Como o Conecta TV reporta

No aplicativo de filmes/séries, defina `CENTRAL_URL` com o endereço da central
(e `CENTRAL_TOKEN`, se usar). Cada sessão passa a aparecer no painel: título,
fonte, áudio (dublado ou original), resolução e se abriu.
