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

test('valida registros do disco sem perder as candidatas antigas válidas', () => {
    const { fila, pasta } = novaFila();
    try {
        const url = 'https://valida.test/filme';
        fs.writeFileSync(fila.arquivo, JSON.stringify({ itens: {
            [url]: { url, nome: 'preservada', tentativas: 'NaN', proxima: 'infinito' },
            'https://nula.test/': null,
            'https://array.test/': [],
            'https://credencial.test/': { url: 'https://pessoa:senha@credencial.test/' },
            'file:///tmp/filme': { url: 'file:///tmp/filme' },
            'chave divergente': { url: 'https://outro.test/filme' },
            'dominio:valida.test/caminho': { falhas: 6, proxima: Date.now() + 999999 },
        } }));
        assert.deepEqual(fila.proximos(10).map(c => c.nome), ['preservada']);
        assert.equal(fila.resumo().total, 1);
        assert.equal(fila.resumo().persistencia.descartados, 6);
        assert.equal(fila.resumo().persistencia.erroCarregamento, 'REGISTROS_INVALIDOS');
        assert.equal(criarFila({ pastaDados: pasta }).resumo().total, 1);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('recupera a última cópia válida quando o arquivo principal fica incompleto', () => {
    const { fila, pasta } = novaFila();
    try {
        fila.enfileirar([{ url: 'https://preservada.test/1', nome: 'guardada' }]);
        fila.proximos(1);
        fs.writeFileSync(fila.arquivo, '{"itens":');
        const recuperada = criarFila({ pastaDados: pasta });
        const antes = recuperada.resumo();
        assert.equal(antes.total, 1);
        assert.equal(antes.persistencia.recuperada, true);
        assert.equal(antes.persistencia.ok, false, 'avisa que ainda está usando a cópia de recuperação');
        assert.deepEqual(recuperada.proximos(1).map(c => c.nome), ['guardada']);
        assert.equal(recuperada.resumo().persistencia.ok, true);
        assert.equal(criarFila({ pastaDados: pasta }).resumo().total, 1, 'repara o principal sem apagar a cópia válida');
        assert.equal(JSON.parse(fs.readFileSync(fila.arquivo + '.bak', 'utf8')).itens['https://preservada.test/1'].nome, 'guardada');
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('formato inválido não derruba a rodada e deixa diagnóstico legível', () => {
    const { fila, pasta } = novaFila();
    try {
        fs.writeFileSync(fila.arquivo, JSON.stringify({ itens: [] }));
        assert.deepEqual(fila.proximos(3), []);
        assert.equal(fila.resumo().persistencia.ok, false);
        assert.equal(fila.resumo().persistencia.erroCarregamento, 'FILA_INVALIDA');
        assert.equal(fila.enfileirar([{ url: 'https://nova.test/1' }]), 1);
        assert.equal(fila.resumo().persistencia.ok, true);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('disco indisponível mantém a fila em memória e recupera a persistência depois', () => {
    const { pasta } = novaFila();
    const impedimento = path.join(pasta, 'impedimento');
    try {
        fs.writeFileSync(impedimento, 'arquivo onde deveria haver uma pasta');
        const fila = criarFila({ pastaDados: impedimento });
        assert.equal(fila.enfileirar([{ url: 'https://primeira.test/1' }]), 1);
        assert.equal(fila.resumo().total, 1);
        assert.equal(fila.resumo().persistencia.ok, false);
        assert.ok(fila.resumo().persistencia.erroGravacao);
        assert.equal(fila.proximos(1).length, 1);
        fs.unlinkSync(impedimento);
        fila.enfileirar([{ url: 'https://segunda.test/1' }]);
        assert.equal(fila.resumo().persistencia.ok, true);
        assert.equal(fila.resumo().persistencia.erroGravacao, null);
        assert.equal(criarFila({ pastaDados: impedimento }).resumo().total, 2);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('lotes de uma candidata também alternam domínios depois de um reinício', () => {
    const { fila, pasta } = novaFila();
    try {
        fila.enfileirar([
            ...Array.from({ length: 20 }, (_, n) => ({ url: `https://grande.test/${n}` })),
            { url: 'https://pequeno.test/1' }, { url: 'https://terceiro.test/1' },
        ]);
        const primeira = fila.proximos(1)[0];
        assert.equal(new URL(primeira.url).hostname, 'grande.test');
        fila.anotar(primeira.url, { aprovada: true });
        const reiniciada = criarFila({ pastaDados: pasta });
        const segunda = reiniciada.proximos(1)[0];
        assert.equal(new URL(segunda.url).hostname, 'pequeno.test');
        reiniciada.anotar(segunda.url, { aprovada: true });
        assert.equal(new URL(reiniciada.proximos(1)[0].url).hostname, 'terceiro.test');
        assert.deepEqual(fila.proximos(Infinity), []);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('metadados confirmados de addons sobrevivem sem aceitar estruturas enormes ou circulares', () => {
    const { fila, pasta } = novaFila();
    try {
        const detalhes = { addonBase: 'https://addon.test', tipo: 'movie', idsConfirmados: ['tt0111161', 'tt1375666'] };
        const circular = {}; circular.proprio = circular;
        fila.enfileirar([
            { url: 'https://addon.test/1', detalhes },
            { url: 'https://circular.test/1', detalhes: circular },
            { url: 'https://grande.test/1', detalhes: { corpo: 'x'.repeat(17000) } },
        ]);
        detalhes.idsConfirmados.push('alterado depois');
        const lote = criarFila({ pastaDados: pasta }).proximos(3);
        assert.deepEqual(lote.find(c => c.url === 'https://addon.test/1').detalhes.idsConfirmados, ['tt0111161', 'tt1375666']);
        assert.equal(lote.find(c => c.url === 'https://circular.test/1').detalhes, undefined);
        assert.equal(lote.find(c => c.url === 'https://grande.test/1').detalhes, undefined);
        assert.equal(fila.resumo().persistencia.ok, true);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('a espera aumenta para falhas repetidas e tem teto de um dia', () => {
    const { fila, pasta } = novaFila();
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
        const url = 'https://tentativa.test/1';
        fila.enfileirar([{ url }]);
        for (const espera of [10 * 60000, 20 * 60000, 6 * 3600000, 12 * 3600000, 24 * 3600000, 24 * 3600000]) {
            fila.anotar(url, { erroDeDominio: false });
            clock += espera - 1;
            assert.deepEqual(fila.proximos(1), []);
            clock += 1;
            assert.equal(fila.proximos(1).length, 1);
        }
    } finally { Date.now = realNow; fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('uma resposta saudável interrompe a sequência de erros do domínio', () => {
    const { fila, pasta } = novaFila();
    try {
        fila.enfileirar([{ url: 'https://saudavel.test/novo' }]);
        for (let n = 0; n < 3; n++) fila.anotar(`https://saudavel.test/falha${n}`, { erroDeDominio: true });
        assert.equal(fila.resumo().castigadas, 1);
        fila.anotar('https://saudavel.test/respondeu', { erroDeDominio: false });
        assert.equal(fila.resumo().castigadas, 0);
        assert.equal(fila.proximos(1).length, 1);
        fila.anotar('https://saudavel.test/novo', { aprovada: true, erroDeDominio: true });
        assert.equal(fila.resumo().total, 0);
        assert.equal(JSON.parse(fs.readFileSync(fila.arquivo, 'utf8')).itens['dominio:saudavel.test'], undefined);
        fila.anotar('javascript:alert(1)', { erroDeDominio: true });
        assert.equal(fila.enfileirar(null), 0);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('ao atingir o limite elimina tentadas antes de inéditas e preserva o castigo ativo', () => {
    const { fila, pasta } = novaFila();
    try {
        const itens = Object.fromEntries(Array.from({ length: 3998 }, (_, n) => {
            const url = `https://novas.test/${n}`;
            return [url, { url, estado: 'esperando', adicionadoEm: 10 + n }];
        }));
        itens['dominio:castigado.test'] = { falhas: 3, proxima: Date.now() + 3600000, adicionadoEm: 1 };
        itens['https://tentada.test/1'] = { url: 'https://tentada.test/1', estado: 'tentada', tentativas: 1, adicionadoEm: 5 };
        fs.writeFileSync(fila.arquivo, JSON.stringify({ itens }));
        fila.enfileirar([{ url: 'https://extra.test/1' }]);
        const disco = JSON.parse(fs.readFileSync(fila.arquivo, 'utf8')).itens;
        assert.equal(Object.keys(disco).length, 4000);
        assert.ok(disco['dominio:castigado.test']);
        assert.equal(disco['https://tentada.test/1'], undefined);
        assert.ok(disco['https://novas.test/0']);
        assert.ok(disco['https://extra.test/1']);
        assert.equal(fila.resumo().castigadas, 1);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('o limite também protege a memória quando a pasta não pode ser gravada', () => {
    const { pasta } = novaFila();
    try {
        const impedimento = path.join(pasta, 'impedido');
        fs.writeFileSync(impedimento, 'sem diretório');
        const fila = criarFila({ pastaDados: impedimento });
        const candidatas = Array.from({ length: 4010 }, (_, n) => ({ url: `https://limite.test/${n}` }));
        assert.equal(fila.enfileirar(candidatas), 4000, 'conta apenas as candidatas que realmente ficaram guardadas');
        assert.equal(fila.resumo().total, 4000);
        assert.equal(fila.resumo().persistencia.descartados, 10);
        assert.equal(fila.resumo().persistencia.ok, false);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('uma alteração externa no arquivo não substitui o backup por JSON corrompido', () => {
    const { fila, pasta } = novaFila();
    try {
        fila.enfileirar([{ url: 'https://preservada.test/1' }]);
        fila.proximos(1);
        fs.writeFileSync(fila.arquivo, 'incompleto');
        fila.enfileirar([{ url: 'https://nova.test/1' }]);
        const backup = JSON.parse(fs.readFileSync(fila.arquivo + '.bak', 'utf8'));
        assert.ok(backup.itens['https://preservada.test/1']);
        assert.equal(criarFila({ pastaDados: pasta }).resumo().total, 2);
        assert.equal(fs.existsSync(fila.arquivo + '.bak.tmp'), false);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
