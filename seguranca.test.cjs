const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const seguranca = require('./seguranca');

function pedido(extra = {}) {
    return {
        method: 'GET', path: '/api/playback/1', headers: {}, socket: { remoteAddress: '203.0.113.10' },
        ...extra
    };
}
function resposta() {
    const cabecalhos = {};
    return {
        statusCode: 200, corpo: null, cabecalhos,
        setHeader(nome, valor) { cabecalhos[String(nome).toLowerCase()] = valor; },
        status(codigo) { this.statusCode = codigo; return this; },
        json(dados) { this.corpo = dados; return this; },
        type() { return this; },
        send(dados) { this.corpo = dados; return this; },
        sendStatus(codigo) { this.statusCode = codigo; return this; }
    };
}

test('a rede interna nunca é buscada pelo servidor', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.6', '172.16.0.9', '169.254.1.1', '::1', 'caixa.local', 'algo.internal', ''])
        assert.equal(seguranca.hostInterno(host), true, host + ' precisa ser bloqueado');
    for (const host of ['vixsrc.to', 'vid7102402.hclod.qzz.io', '8.8.8.8', 'pipocacine.lat'])
        assert.equal(seguranca.hostInterno(host), false, host + ' é público');
});

test('CORS só devolve permissão para o próprio site e para as origens autorizadas', () => {
    const cabecalho = seguranca.cabecalhos({ origensPermitidas: ['https://central.exemplo.com'] });
    const igual = resposta();
    cabecalho(pedido({ headers: { origin: 'https://localhost:3000', host: 'localhost:3000' } }), igual, () => {});
    assert.equal(igual.cabecalhos['access-control-allow-origin'], 'https://localhost:3000');

    const autorizada = resposta();
    cabecalho(pedido({ headers: { origin: 'https://central.exemplo.com', host: 'app.exemplo.com' } }), autorizada, () => {});
    assert.equal(autorizada.cabecalhos['access-control-allow-origin'], 'https://central.exemplo.com');

    const estranha = resposta();
    cabecalho(pedido({ headers: { origin: 'https://site-qualquer.com', host: 'app.exemplo.com' } }), estranha, () => {});
    assert.equal(estranha.cabecalhos['access-control-allow-origin'], undefined, 'origem desconhecida não recebe permissão');
    assert.match(String(estranha.cabecalhos['content-security-policy']), /default-src 'self'/);
    assert.equal(estranha.cabecalhos['x-content-type-options'], 'nosniff');
});

test('o limite de uso protege a API e é mais generoso com o vídeo', () => {
    const limite = seguranca.criarLimitador({ janelaMs: 60000, maximo: 3, maximoMidia: 5, janelaMidiaMs: 600000 });
    const passar = (caminho) => {
        let seguiu = false;
        const res = resposta();
        limite(pedido({ path: caminho }), res, () => { seguiu = true; });
        return { seguiu, res };
    };
    for (let i = 0; i < 3; i++) assert.equal(passar('/api/playback/1').seguiu, true);
    const bloqueado = passar('/api/playback/1');
    assert.equal(bloqueado.seguiu, false);
    assert.equal(bloqueado.res.statusCode, 429);
    // O vídeo tem o próprio teto: continua passando enquanto a API já bloqueou.
    for (let i = 0; i < 5; i++) assert.equal(passar('/api/hls').seguiu, true);
    assert.equal(passar('/api/hls').seguiu, false);
});

test('com código configurado, só entra aparelho autorizado', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-seg-'));
    const arquivo = path.join(pasta, 'autorizados.json');
    const portao = seguranca.criarPortao({ codigo: 'segredo-da-familia', arquivo });

    const semCracha = resposta();
    portao.middleware(pedido({ headers: { accept: 'application/json' } }), semCracha, () => { throw Error('não podia passar'); });
    assert.equal(semCracha.statusCode, 401);

    const entrada = resposta();
    await portao.rotaEntrada(pedido({ method: 'POST', body: { codigo: 'segredo-da-familia', nome: 'Marlon', dispositivo: 'd1' } }), entrada);
    assert.equal(entrada.corpo.ok, true);
    const cracha = entrada.corpo.token;
    assert.match(entrada.cabecalhos['set-cookie'], /conecta_acesso=/);
    assert.match(entrada.cabecalhos['set-cookie'], /HttpOnly/);

    let liberou = false;
    portao.middleware(pedido({ headers: { cookie: 'conecta_acesso=' + cracha, accept: 'application/json' } }), resposta(), () => { liberou = true; });
    assert.equal(liberou, true, 'aparelho com crachá entra');

    const errado = resposta();
    await portao.rotaEntrada(pedido({ method: 'POST', body: { codigo: 'chute' } }), errado);
    assert.equal(errado.statusCode, 401);

    const html = resposta();
    portao.middleware(pedido({ path: '/', headers: { accept: 'text/html' } }), html, () => {});
    assert.equal(html.statusCode, 401);
    assert.match(String(html.corpo), /Código de acesso/);

    for (let i = 0; i < 9; i++) { const r = resposta(); await portao.rotaEntrada(pedido({ method: 'POST', body: { codigo: 'chute' } }), r); }
    const castigado = resposta();
    await portao.rotaEntrada(pedido({ method: 'POST', body: { codigo: 'chute' } }), castigado);
    assert.equal(castigado.statusCode, 429, 'tentativas em excesso são barradas');
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('sem código configurado, o aplicativo segue funcionando como sempre', () => {
    const portao = seguranca.criarPortao({ codigo: '', arquivo: path.join(os.tmpdir(), 'nao-existe.json') });
    let liberou = false;
    portao.middleware(pedido(), resposta(), () => { liberou = true; });
    assert.equal(liberou, true);
});
