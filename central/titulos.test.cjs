const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarRegistro } = require('./titulos.js');

function pastaDeTeste() {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'titulos-central-'));
    return pasta;
}

test('guarda a escolha do avaliador e a qualidade medida pelo player', () => {
    const pasta = pastaDeTeste();
    const registro = criarRegistro({ pastaDados: pasta });

    registro.registrar({
        em: '2026-10-08T12:00:00.000Z', tipo: 'avaliacao', id: '921', titulo: 'A Luta pela Esperança',
        fonte: 'PipocaCine · dublado', fonteId: 'pipoca',
        avaliacao: [{ fonte: 'pipoca', nota: 5.2, idioma: 'português confirmado pela central', qualidade: '720p' }, { fonte: 'watchplay', nota: -1.5, idioma: 'a central ouviu outro idioma', qualidade: '720p' }],
    });
    registro.registrar({
        em: '2026-10-08T12:00:40.000Z', tipo: 'confirmacao', id: '921', titulo: 'A Luta pela Esperança',
        fonte: 'PipocaCine · dublado', fonteId: 'pipoca', resolucao: '720p', taxa: '3000 kbps', audio: 'Dublado',
    });

    const lista = registro.listar();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].qualidade.resolucao, '720p');
    assert.equal(lista[0].qualidade.taxa, '3000 kbps');
    assert.equal(lista[0].escolha.fonteId, 'pipoca');
    assert.equal(lista[0].escolha.disputa.length, 2);
    assert.equal(lista[0].plays, 1);
    assert.equal(lista[0].historico.length, 2);
});

test('série é agrupada por título (sem separar por episódio) e falhas contam', () => {
    const pasta = pastaDeTeste();
    const registro = criarRegistro({ pastaDados: pasta });
    registro.registrar({ em: '2026-10-08T10:00:00.000Z', tipo: 'confirmacao', id: '1399', titulo: 'Game of Thrones', temporada: '1', numero: '1', fonte: 'WatchPlay', fonteId: 'watchplay', resolucao: '720p' });
    registro.registrar({ em: '2026-10-08T10:05:00.000Z', tipo: 'falha', id: '1399', titulo: 'Game of Thrones', temporada: '1', numero: '2', fonte: 'WatchPlay', fonteId: 'watchplay', motivo: 'não abriu' });

    const lista = registro.listar();
    assert.equal(lista.length, 1, 'os dois episódios caem no mesmo título');
    assert.equal(lista[0].chave, 'tv:1399');
    assert.equal(lista[0].falhas, 1);
    assert.equal(lista[0].historico.length, 2);
});

test('resumo do painel traz título, fonte, qualidade e a disputa das fontes', () => {
    const pasta = pastaDeTeste();
    const registro = criarRegistro({ pastaDados: pasta });
    registro.registrar({
        em: '2026-10-08T11:00:00.000Z', tipo: 'avaliacao', id: '1101412', titulo: 'A Queda 2',
        fonte: 'FenixFlix · dublado', fonteId: 'fenix', avaliacao: [{ fonte: 'fenix', nota: 4.8, qualidade: '720p', taxa: '2.0 Mbps' }],
    });
    const resumo = registro.resumo(5);
    assert.equal(resumo[0].titulo, 'A Queda 2');
    assert.equal(resumo[0].fonte, 'FenixFlix · dublado');
    assert.equal(resumo[0].disputa[0].nota, 4.8);
    assert.equal(registro.total(), 1);
});

test('o arquivo sobrevive à reabertura (a central guarda entre reinícios)', () => {
    const pasta = pastaDeTeste();
    const primeiro = criarRegistro({ pastaDados: pasta });
    primeiro.registrar({ em: '2026-10-08T09:00:00.000Z', tipo: 'confirmacao', id: '27205', titulo: 'A Origem', fonte: 'PipocaCine', fonteId: 'pipoca', resolucao: '720p' });
    const segundo = criarRegistro({ pastaDados: pasta });
    assert.equal(segundo.total(), 1);
    assert.equal(segundo.listar()[0].titulo, 'A Origem');
});
