const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { criarPlacar, identificador } = require('./placar');

function comEventos(linhas) {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'placar-'));
    const arquivo = path.join(pasta, 'eventos.ndjson');
    fs.writeFileSync(arquivo, linhas.map(l => JSON.stringify(l)).join('\n') + '\n');
    const placar = criarPlacar({ arquivoEventos: arquivo });
    placar.atualizar();
    return { placar, pasta };
}

const agora = new Date().toISOString();

test('o nome da fonte vira o mesmo identificador do motor', () => {
    assert.equal(identificador({ fonte: 'Dublado limpo' }), 'watchplay');
    assert.equal(identificador({ fonte: 'PipocaCine · dublado' }), 'pipoca');
    assert.equal(identificador({ fonte: 'Vixsrc' }), 'vixsrc');
    assert.equal(identificador({ fonteId: 'site-novo' }), 'site-novo');
    assert.equal(identificador({ fonte: '' }), '');
});

test('conta aberturas, confirmações e falhas por fonte', () => {
    const { placar, pasta } = comEventos([
        { em: agora, tipo: 'play', fonte: 'Vixsrc', titulo: 'Filme A' },
        { em: agora, tipo: 'confirmacao', fonte: 'Vixsrc', titulo: 'Filme A' },
        { em: agora, tipo: 'falha', ok: false, fonte: 'Vixsrc', titulo: 'Filme B', motivo: 'não abriu' },
        { em: agora, tipo: 'play', fonteId: 'pipoca', titulo: 'Filme C' },
        // Medição de robô não conta como uso real.
        { em: agora, tipo: 'vigia', fonte: 'Vixsrc' },
        { em: agora, tipo: 'avaliacao', fonte: 'PipocaCine' },
    ]);
    const vixsrc = placar.resumo().find(f => f.id === 'vixsrc');
    assert.equal(vixsrc.aberturas, 1);
    assert.equal(vixsrc.confirmacoes, 1);
    assert.equal(vixsrc.falhas, 1);
    assert.equal(vixsrc.taxaFalha, 50);
    const porTitulo = new Map(vixsrc.titulos.map(t => [t.titulo, t]));
    assert.equal(porTitulo.get('Filme A').aberturas, 1);
    assert.equal(porTitulo.get('Filme A').confirmacoes, 1);
    assert.equal(porTitulo.get('Filme A').falhas, 0);
    assert.equal(porTitulo.get('Filme B').falhas, 1);
    assert.equal(placar.resumo().length, 2, 'só as fontes com relato de uso entram');
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('fonte que falha sempre derruba a nota; quem só acerta sobe', () => {
    const eventos = [];
    for (let i = 0; i < 4; i++) eventos.push({ em: agora, tipo: 'falha', ok: false, fonteId: 'ruim', motivo: 'não abriu' });
    for (let i = 0; i < 4; i++) eventos.push({ em: agora, tipo: 'confirmacao', fonteId: 'boa' });
    const { placar, pasta } = comEventos(eventos);
    assert.ok(placar.ajuste('ruim') <= -1.5, 'fonte que só falha perde bastante: ' + placar.ajuste('ruim'));
    assert.ok(placar.ajuste('boa') > 0, 'fonte que só acerta ganha pontos: ' + placar.ajuste('boa'));
    assert.equal(placar.ajuste('desconhecida'), 0);
    const problematicas = placar.problematicas();
    assert.deepEqual(problematicas.map(p => p.id), ['ruim']);
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('relato antigo (fora da janela) não conta', () => {
    const antigo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { placar, pasta } = comEventos([{ em: antigo, tipo: 'falha', ok: false, fonteId: 'antiga' }]);
    assert.deepEqual(placar.resumo(), []);
    fs.rmSync(pasta, { recursive: true, force: true });
});
