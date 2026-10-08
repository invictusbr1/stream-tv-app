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

## 6. Caçador de fornecedores por categoria

No painel, o bloco **“Fornecedores (nota 0 a 10)”** agora tem categorias:
**Filmes · Séries · Animes · Doramas e novelas · TV ao vivo**.

Escolha a categoria e toque em **“Buscar fontes de …”**. A busca roda em segundo
plano (alguns minutos) e o painel se atualiza sozinho.

### Como a nota é calculada

Para Filmes, Séries, Animes e Doramas — a régua do projeto:

> dublado (3,0) + sem anúncio (2,0) + qualidade HD/Full HD (2,0) +
> quantos títulos abriram (2,0) + velocidade (1,0) = **nota de 0 a 10**

Para **TV ao vivo** (não existe “dublado”):

> quantidade de canais (3,0) + sem anúncio (2,0) + qualidade (2,0) +
> canais que responderam (2,0) + velocidade (1,0)

### Quantos títulos são testados

- **Filmes:** 6 títulos (A Origem, Coração Partido, Duna 2, Divertida Mente 2,
  Oppenheimer, Deadpool & Wolverine)
- **Séries:** 6 títulos (GoT, The Last of Us, The Boys, Wandinha, Stranger
  Things, Breaking Bad)
- **Animes:** 6 títulos (Jujutsu Kaisen, Demon Slayer, Attack on Titan,
  One Piece, Naruto Shippuden, Dragon Ball Super)
- **Doramas:** 6 títulos (Round 6, Crash Landing on You, Itaewon Class,
  Vincenzo, Alice in Borderland, La Casa de Papel)
- **TV ao vivo:** 7 listas do projeto **iptv-org** (GitHub, gratuito) — Brasil,
  canais em português, América Latina, filmes, esportes, notícias e a lista
  mundial. Em cada lista, o robô abre 8 canais e mede resposta e qualidade.

### O que já foi medido (primeira rodada real)

| Categoria | Melhor fonte | Nota | Detalhe |
| --- | --- | --- | --- |
| Animes | PipocaCine · série (arquivo limpo) | **9,1** | 5 de 6 animes dublados, 720p |
| Doramas | PipocaCine · série (arquivo limpo) | **8,4** | 3 de 6 dublados, 720p |
| TV ao vivo | IPTV-org · notícias | **10** | 979 canais, 100% responderam, 1080p |
| TV ao vivo | IPTV-org · esportes | 9,8 | 393 canais, 88% responderam |
| TV ao vivo | IPTV-org · canais do Brasil | 9,0 | 382 canais, 50% responderam |

Observação honesta sobre TV ao vivo: as listas do iptv-org são gratuitas e sem
anúncio, mas muitos canais ficam fora do ar ou bloqueados por região — por isso
a taxa de resposta varia (25% a 100% conforme a lista). O robô mede e mostra
essa taxa, em vez de prometer o que não entrega.
