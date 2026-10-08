const test = require('node:test');
const assert = require('node:assert/strict');
const { criarRevisor } = require('./revisor.js');

// Registro de títulos de mentira, com dois problemas e um título saudável.
function titulosDeTeste() {
    const lista = [
        { chave: 'movie:921', id: '921', tipo: 'movie', titulo: 'A Luta pela Esperança', falhas: 3, falhasSeguidas: 3, motivos: ['3 falhas seguidas'], revisao: null },
        { chave: 'tv:1399', id: '1399', tipo: 'tv', titulo: 'Game of Thrones', falhas: 1, falhasSeguidas: 1, motivos: ['1 falha(s) e nunca tocou'], ultimoEpisodio: { temporada: '2', numero: '5' }, revisao: null },
        { chave: 'movie:27205', id: '27205', tipo: 'movie', titulo: 'A Origem', falhas: 0, falhasSeguidas: 0, motivos: [], revisao: null },
    ];
    const anotacoes = [];
    return {
        lista, anotacoes,
        comProblema: (limite) => lista.filter(t => t.falhasSeguidas >= 2 || (t.falhas >= 1 && t.falhasSeguidas >= 1)).slice(0, limite),
        anotarRevisao: (chave, dados) => { anotacoes.push({ chave, ...dados }); const item = lista.find(t => t.chave === chave); if (item) item.revisao = dados; return dados; },
    };
}

function agenteDeTeste(resultado) {
    const chamadas = [];
    return {
        chamadas,
        investigar: async (alvo, motivo) => {
            chamadas.push({ alvo, motivo });
            return resultado;
        },
    };
}

test('revisa os títulos com problema e guarda a solução encontrada', async () => {
    const titulos = titulosDeTeste();
    const agente = agenteDeTeste({ estado: 'resolvido', tentativas: 1, solucao: { fonte: 'PipocaCine', caminho: 'dublado', audio: 'pt-BR', resolucao: '720p' } });
    const revisor = criarRevisor({ titulos, agente, maxPorRodada: 2, minimoEntreRevisoes: 0 });

    const resultado = await revisor.revisarAgora(2);
    assert.equal(resultado.revisados, 2);
    assert.equal(agente.chamadas.length, 2);
    // O episódio lembrado do título é usado na revisão da série.
    const serie = agente.chamadas.find(c => c.alvo.tipo === 'tv');
    assert.equal(serie.alvo.temporada, '2');
    assert.equal(serie.alvo.episodio, '5');
    assert(titulos.anotacoes.every(a => a.ok === true));
    assert.equal(resultado.resultados[0].solucao.fonte, 'PipocaCine');
});

test('sem solução, anota que continua devendo (e tenta de novo depois)', async () => {
    const titulos = titulosDeTeste();
    const agente = agenteDeTeste({ estado: 'pendente', tentativas: 2, solucao: null });
    const revisor = criarRevisor({ titulos, agente, maxPorRodada: 1, minimoEntreRevisoes: 0 });

    const primeiro = await revisor.revisarAgora(1);
    assert.equal(primeiro.resultados[0].ok, false);
    assert.equal(titulos.anotacoes[0].ok, false);

    // Com um tempo mínimo entre revisões, a segunda rodada não repete o título
    // recém-revisado (o outro pendente pode continuar sendo atendido).
    const chamadasAntes = agente.chamadas.length;
    const revisorEsperto = criarRevisor({ titulos, agente, maxPorRodada: 2, minimoEntreRevisoes: 60 * 60 * 1000 });
    const segundo = await revisorEsperto.revisarAgora(1);
    const revisados = agente.chamadas.slice(chamadasAntes).map(c => c.alvo.id);
    assert(!revisados.includes('921'), 'não revisa de novo o título que acabou de ser revisado');
});

test('não roda duas revisões ao mesmo tempo', async () => {
    const titulos = titulosDeTeste();
    let liberar;
    const agente = {
        investigar: () => new Promise(resolve => { liberar = resolve; }),
    };
    const revisor = criarRevisor({ titulos, agente, maxPorRodada: 1, minimoEntreRevisoes: 0 });
    const primeira = revisor.revisarAgora(1);
    const segunda = await revisor.revisarAgora(1);
    assert.equal(segunda.rodando, true);
    liberar({ estado: 'resolvido', tentativas: 1, solucao: { fonte: 'X' } });
    await primeira;
    assert.equal(revisor.rodando(), false);
});
