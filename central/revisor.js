'use strict';
// Revisor automático de títulos.
//
// O avaliador e o player registram o que aconteceu em cada título. Quando algo
// fica ruim (falhas seguidas, nunca tocou, ou a qualidade caiu em relação ao
// que já rodou), este revisor pega o caso e MANDA O AGENTE TESTAR as fontes de
// novo — guardando a solução encontrada.
//
// Regras:
//   - revisa no máximo alguns títulos por rodada (para não pesar na rede);
//   - não repete a revisão do mesmo título antes de um tempo mínimo;
//   - se o aplicativo estiver fechado, simplesmente não consegue testar e
//     tenta de novo na próxima rodada;
//   - nada é alterado no aplicativo: o revisor só mede e anota.

const INTERVALO = 30 * 60 * 1000;        // roda a cada 30 minutos
const MINIMO_ENTRE_REVISOES = 30 * 60 * 1000;
const MAX_POR_RODADA = 3;
const PRIMEIRA_RODADA = 90 * 1000;       // espera o aplicativo acordar

function criarRevisor({ titulos, agente, intervalo = INTERVALO, minimoEntreRevisoes = MINIMO_ENTRE_REVISOES, maxPorRodada = MAX_POR_RODADA, registrar = () => {} }) {
    let rodando = false;
    let ultimaRodada = 0;
    let ultimoResultado = [];

    function podeRevisar(problema) {
        if (!problema.revisao) return true;
        const quando = new Date(problema.revisao.em).getTime();
        if (!Number.isFinite(quando)) return true;
        return Date.now() - quando > minimoEntreRevisoes;
    }

    async function revisarAgora(limite = maxPorRodada) {
        if (rodando) return { rodando: true, revisados: 0, resultados: [] };
        rodando = true;
        try {
            const problemas = (titulos.comProblema(12) || []).filter(podeRevisar).slice(0, Math.max(1, limite));
            const resultados = [];
            for (const problema of problemas) {
                const alvo = problema.tipo === 'tv'
                    ? {
                        tipo: 'tv', id: String(problema.id), titulo: problema.titulo,
                        temporada: (problema.ultimoEpisodio && problema.ultimoEpisodio.temporada) || '1',
                        episodio: (problema.ultimoEpisodio && problema.ultimoEpisodio.numero) || '1',
                    }
                    : { tipo: 'movie', id: String(problema.id), titulo: problema.titulo };
                registrar(`revisando "${problema.titulo}" (${problema.motivos.join('; ')})…`);
                const caso = await Promise.resolve(agente.investigar(alvo, 'revisão automática: ' + problema.motivos.join('; '))).catch(() => null);
                const resolvido = Boolean(caso && caso.estado === 'resolvido' && caso.solucao);
                const anotacao = titulos.anotarRevisao(problema.chave, {
                    em: new Date().toISOString(),
                    ok: resolvido,
                    solucao: resolvido ? caso.solucao : null,
                    tentativas: caso ? caso.tentativas : 0,
                    motivo: resolvido ? '' : 'nenhuma fonte respondeu na revisão',
                });
                resultados.push({ chave: problema.chave, titulo: problema.titulo, ok: resolvido, solucao: resolvido ? caso.solucao : null, anotacao });
                registrar(resolvido
                    ? `"${problema.titulo}" resolvido com ${caso.solucao.fonte || caso.solucao.caminho}`
                    : `"${problema.titulo}" continua sem fonte nesta rodada`);
            }
            ultimaRodada = Date.now();
            ultimoResultado = resultados;
            return { revisados: resultados.length, resultados };
        } finally {
            rodando = false;
        }
    }

    function iniciar() {
        setTimeout(() => { revisarAgora().catch(() => {}); }, PRIMEIRA_RODADA);
        setInterval(() => { revisarAgora().catch(() => {}); }, intervalo);
    }

    function resumo() {
        return { rodando, ultimaRodada, ultimoResultado };
    }

    return { revisarAgora, iniciar, resumo, rodando: () => rodando };
}

module.exports = { criarRevisor, INTERVALO, MINIMO_ENTRE_REVISOES, MAX_POR_RODADA };
