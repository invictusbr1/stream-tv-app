# Seleção de qualidade — 2.13.106

## Problema e método

Uma fonte lenta podia ainda estar em medição quando o orçamento terminava. O seletor abria a reserva inferior; o diagnóstico podia continuar em `sonda`, com tempo zero. Um fornecedor com vários arquivos também podia deixar uma alternativa superior descoberta sem oportunidade de medição.

A escolha passa a ter uma rodada de até 8 segundos e uma revisão dirigida de até 4 segundos, tanto no seletor do APK quanto no backend. A segunda rodada ocorre quando a primeira não confirmou 4K e há prova inconclusiva ou arquivo descoberto ainda não medido. Não recomeça toda a descoberta e não mede novamente a reserva já confirmada. Arquivos ainda não examinados ganham oportunidade antes da repetição de uma leitura lenta.

O resultado da revisão compete com a reserva anterior: áudio comprovado, dimensões reais e compatibilidade continuam tendo prioridade. A revisão não pode substituir a reserva por uma opção inferior. O APK isola a fila da segunda rodada para conexões canceladas da primeira não ocuparem suas vagas. A decisão e o diagnóstico usam cópias das medições, evitando alterações tardias de tarefas canceladas.

O diagnóstico encerra estados de consulta/medição pendentes com tempo real da rodada. Quando há vários arquivos do mesmo fornecedor, informa sua melhor medição conforme a mesma prioridade da escolha. A tela normal do player permanece discreta.

O backend também reconhece uma faixa portuguesa explicitamente declarada na lista HLS como prova, além da faixa padrão e da prova da central. O player já seleciona a faixa portuguesa. Etiqueta comercial de resolução ou dublagem, isoladamente, não recebe essa promoção.

## Orçamento e limites

O orçamento da escolha sobe de 10 para até 12 segundos nos casos inconclusivos. Operações que terminam antes retornam antes. Tempo até a primeira imagem, tráfego de rede e atraso do sistema operacional não são uma garantia de 12 segundos.

4K confirmado evita a rodada adicional. Isso não comprova que não exista uma alternativa ainda maior ou temporariamente inacessível. Uma fonte que não respondeu permanece inconclusiva, em vez de ser considerada prova de que aquela qualidade não existe.

TLS, entrega segura do ClickHost, codecs, validação de idioma, fornecedores aprovados sem anúncios e orçamento de início de reprodução foram preservados. Não há exceção por filme nem novo fornecedor. Uma tentativa experimental de antecipar a consulta ao gateway foi descartada antes da publicação: não demonstrou benefício geral e adicionava consultas.

## Verificação antes da publicação

- 536 testes completos passaram. Após o ajuste final apenas na consolidação do diagnóstico, os 27 testes nativos/diagnóstico pertinentes passaram novamente.
- Regressões específicas: revisão em 480p/720p/Full HD/1440p/4K; outro idioma; fonte incompatível; prazo; conservação da reserva; não repetir a reserva; múltiplos arquivos; exclusões; títulos e episódios separados; links efêmeros; cache; metadados por faixas; privacidade do diagnóstico.
- 24 consultas de referência em produção: duas passagens em 12 títulos.
- 24 consultas comparativas do backend em bancada: método anterior e novo, nos mesmos 12 títulos, com descoberta e leitura reais pela rede.
- Comparação do seletor/leitor de mídia Java em seis títulos e repetição final do método novo nos seis. A bancada usa as classes do APK para seleção, HTTPS e metadados; a descoberta dos fornecedores é adaptada por um serviço local. Não equivale a um teste físico no telefone, de decodificação Android, ou a assistir aos filmes completos.

Títulos: Matrix, A Origem, Interstellar, Vingadores: Ultimato, Divertidamente 2, Toy Story 5, Oppenheimer, Duna: Parte 2, Tulsa King T1E1, Dexter T1E1, Breaking Bad T1E1 e The Last of Us T1E1. Fornecedores: WatchPlay, Pipoca/Pipoca Série, ClickHost, MGEB e FenixFlix/FenixHub, além da reserva de conversão apenas no backend.

### Tempos do backend, 12 títulos por método

| Método | Mínimo | Mediana | Máximo | Escolhas 4K |
|---|---:|---:|---:|---:|
| Anterior | 5,62 s | 10,01 s | 10,02 s | 4 |
| Duas rodadas | 4,49 s | 12,00 s | 12,01 s | 4 |

São consultas em sequência, com rede e conteúdo variáveis, não um experimento de causalidade com condições idênticas. A nova rodada não aumentou a contagem de 4K nessa amostra do backend; seu ganho de recuperação é demonstrado pelos cenários controlados e por opções recuperadas nas medições Java. O custo real da revisão em fontes indisponíveis está explicitado acima.

### Repetição final da bancada Java

| Título | Escolha | Dimensões | Áudio nos metadados | Tempo total |
|---|---|---|---|---:|
| Interstellar | FenixHub | 3840 × 1600 | Português | 8,02 s |
| Matrix | FenixHub | 1280 × 532 | Português | 12,03 s |
| Toy Story 5 | ClickHost | 3840 × 2160 | Português | 6,86 s |
| Oppenheimer | FenixHub | 3840 × 1744 | Português | 7,89 s |
| Tulsa King T1E1 | FenixHub | 1280 × 720 | Português | 12,06 s |
| Dexter T1E1 | FenixHub | 1280 × 720 | Não declarado | 11,43 s |

O último caso não confirma dublagem por metadados; a bancada não aplica as provas privadas da central. Não apresentar esse resultado como prova de português.

O intermediário `dbonline.tech-cdn.top` do ClickHost apresentou timeout em testes independentes. A falha não foi tratada como ausência definitiva do filme. Toy Story utilizou outro caminho e entregou o arquivo 4K. Os testes de rede mostraram variação entre consultas; não há garantia de qualidade máxima absoluta enquanto um fornecedor está inacessível.

Os registros de bancada guardam somente nomes, dimensões, tempos e estados no relatório. Não publicar URLs assinadas, credenciais ou arquivos de mídia.

## Conferência após publicação

APK celular e TV 2.13.106 (código 436) compilados, assinaturas e lint conferidos. O motor no servidor apresentou o mesmo SHA-256 do arquivo testado, versão 2.13.106, orçamento 12000 ms, cache web atualizado e checagem de saúde aprovada.

Na consulta final online, Toy Story 5 confirmou 3840 × 2160 e português em 7,63 s. Interstellar confirmou somente 1280 × 720 em 12,18 s, embora a bancada Java tivesse obtido 3840 × 1600. Uma conferência isolada do FenixHub no servidor retornou zero endereços em 3,08 s. As fichas completas desse fornecedor no servidor e na bancada tinham SHA-256 idêntico. Portanto, não há evidência de ficha desatualizada; as respostas variaram entre acessos/consultas. Isso não comprova qual restrição ou instabilidade do fornecedor causou a diferença.

Não apresentar a publicação como garantia de 4K em todos os títulos ou como resolução de toda indisponibilidade externa. A melhoria é do processo de comparação e revisão, com os limites e resultados reais registrados acima.
