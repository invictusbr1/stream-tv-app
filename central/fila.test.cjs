const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { criarFila } = require('./fila');

function novaFila() {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'fila-'));
    return { fila: criarFila({ pastaDados: pasta }), pasta };
}

test('guarda as candidatas e devolve as que já podem ser testadas', () => {
    const { fila, pasta } = novaFila();
    const novas = fila.enfileirar([
        { nome: 'um', url: 'https://site.test/filme/1' },
        { nome: 'dois', url: 'https://outro.test/filme/2' },
        { nome: 'repetida', url: 'https://site.test/filme/1' },
    ]);
    assert.equal(novas, 2, 'a repetida não entra duas vezes');
    const proximas = fila.proximos(5);
    assert.deepEqual(proximas.map(c => c.nome).sort(), ['dois', 'um']);
    assert.equal(fila.resumo().total, 2);
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('a fila sobrevive ao reinício (é gravada no disco)', () => {
    const { fila, pasta } = novaFila();
    fila.enfileirar([{ nome: 'guardada', url: 'https://site.test/filme/9' }]);
    const outra = criarFila({ pastaDados: pasta });
    assert.deepEqual(outra.proximos(3).map(c => c.nome), ['guardada']);
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('quem falha três vezes sai da frente por um tempo', () => {
    const { fila, pasta } = novaFila();
    fila.enfileirar([{ nome: 'teimosa', url: 'https://site.test/filme/7' }]);
    for (let i = 0; i < 3; i++) fila.anotar('https://site.test/filme/7', { estado: 'descartada', motivo: 'não abriu' });
    assert.deepEqual(fila.proximos(3), [], 'depois de três tentativas ela descansa');
    assert.equal(fila.resumo().total, 1, 'mas continua guardada para depois');
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('candidata que virou fonte sai da fila', () => {
    const { fila, pasta } = novaFila();
    fila.enfileirar([{ nome: 'boa', url: 'https://site.test/filme/3' }]);
    fila.anotar('https://site.test/filme/3', { aprovada: true, estado: 'promover' });
    assert.equal(fila.resumo().total, 0);
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('domínio que só dá erro fica castigado (e some do bolo)', () => {
    const { fila, pasta } = novaFila();
    fila.enfileirar([
        { nome: 'a', url: 'https://ruim.test/filme/1' },
        { nome: 'b', url: 'https://ruim.test/filme/2' },
        { nome: 'c', url: 'https://ruim.test/filme/3' },
    ]);
    for (let i = 0; i < 6; i++) fila.anotar(`https://ruim.test/filme/${i}`, { estado: 'sem-resposta', erroDeDominio: true });
    assert.deepEqual(fila.proximos(5), [], 'domínio castigado não é mais chamado agora');
    assert.equal(fila.resumo().castigadas, 1);
    fs.rmSync(pasta, { recursive: true, force: true });
});
