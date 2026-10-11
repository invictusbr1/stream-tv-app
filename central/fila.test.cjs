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

test('castigo por três falhas bloqueia outras URLs e expira depois de seis horas', () => {
    const { fila, pasta } = novaFila();
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
        fila.enfileirar([{ nome: 'aguardando', url: 'https://dominio.test/novo' }]);
        for (let i = 0; i < 3; i++) fila.anotar(`https://dominio.test/falha${i}`, { erroDeDominio: true });
        assert.deepEqual(fila.proximos(5), []);
        assert.equal(fila.resumo().esperando, 0);
        clock += 6 * 60 * 60 * 1000 + 1;
        assert.equal(fila.proximos(5).length, 1);
        assert.equal(fila.resumo().castigadas, 0);
    } finally { Date.now = realNow; fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('seis falhas não bloqueiam o domínio para sempre; sucesso limpa o castigo', () => {
    const { fila, pasta } = novaFila();
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
        const url = 'https://recuperado.test/novo';
        fila.enfileirar([{ nome: 'recuperável', url }]);
        for (let i = 0; i < 6; i++) fila.anotar(`https://recuperado.test/falha${i}`, { erroDeDominio: true });
        clock += 24 * 60 * 60 * 1000 + 1;
        assert.equal(fila.proximos(5).length, 1);
        fila.anotar(url, { aprovada: true });
        const disco = JSON.parse(fs.readFileSync(fila.arquivo, 'utf8'));
        assert.equal(disco.itens['dominio:recuperado.test'], undefined);
    } finally { Date.now = realNow; fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('lote distribui tentativas entre domínios sem perder candidatas', () => {
    const { fila, pasta } = novaFila();
    try {
        fila.enfileirar([
            { url: 'https://grande.test/1' }, { url: 'https://grande.test/2' },
            { url: 'https://grande.test/3' }, { url: 'https://novo.test/1' },
            { url: 'https://terceiro.test/1' },
        ]);
        assert.deepEqual(fila.proximos(3).map(c => new URL(c.url).hostname), ['grande.test', 'novo.test', 'terceiro.test']);
        assert.equal(fila.proximos(10).length, 5);
        assert.deepEqual(fila.proximos(-1), []);
        assert.deepEqual(fila.proximos(NaN), []);
        assert.equal(criarFila({ pastaDados: pasta }).resumo().total, 5);
        assert.equal(fs.existsSync(path.join(pasta, 'fila.json.tmp')), false);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('fila rejeita endereços inválidos e credenciais embutidas', () => {
    const { fila, pasta } = novaFila();
    try {
        assert.equal(fila.enfileirar([{url:'javascript:alert(1)'},{url:'inválida'},{url:'https://usuario:senha@site.test/a'},{url:'https://publico.test/a'}]), 1);
        assert.equal(fila.resumo().total, 1);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
