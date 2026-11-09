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

test('WebView recebe CORS para relatos e Jarvis, preservando o portão', () => {
    const middleware = seguranca.cabecalhos();
    for (const rota of ['/api/acesso', '/api/evento', '/api/jarvis', '/api/entrar']) {
        const res = resposta();
        let passou = false;
        middleware(pedido({ method: 'OPTIONS', path: rota, headers: {
            origin: 'https://appassets.androidplatform.net', host: 'servidor.test',
            'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type'
        } }), res, () => { passou = true; });
        assert.equal(res.statusCode, 204);
        assert.equal(passou, false);
        assert.equal(res.cabecalhos['access-control-allow-origin'], 'https://appassets.androidplatform.net');
        assert.match(res.cabecalhos['access-control-allow-headers'], /Content-Type/);
        const post = resposta();
        middleware(pedido({ method: 'POST', path: rota, headers: { origin: 'https://appassets.androidplatform.net' } }), post, () => {});
        assert.equal(post.cabecalhos['access-control-allow-origin'], 'https://appassets.androidplatform.net');
    }
    const restrita = resposta();
    middleware(pedido({ path: '/api/dispositivos', headers: { origin: 'https://appassets.androidplatform.net' } }), restrita, () => {});
    assert.equal(restrita.cabecalhos['access-control-allow-origin'], undefined);
});

test('com código configurado, só entra aparelho autorizado', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-seg-'));
    const arquivo = path.join(pasta, 'autorizados.json');
    const portao = seguranca.criarPortao({ codigo: 'segredo-da-familia', arquivo });

    const jarvisSemCracha = resposta();
    portao.middleware(pedido({ path: '/api/jarvis', headers: { accept: 'application/json', origin: 'https://appassets.androidplatform.net' } }), jarvisSemCracha, () => { throw Error('Jarvis precisa de acesso'); });
    assert.equal(jarvisSemCracha.statusCode, 401);
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

test('limite de uso: X-Forwarded-For inventado pelo cliente não troca o IP', () => {
    const { ipDoPedido } = require('./seguranca');
    const pedido = (direto, encaminhado) => ({ socket: { remoteAddress: direto }, headers: encaminhado ? { 'x-forwarded-for': encaminhado } : {} });
    // Cliente da internet falando direto com o servidor: o cabeçalho é ignorado.
    assert.equal(ipDoPedido(pedido('203.0.113.9', '1.2.3.4')), '203.0.113.9');
    // Atrás do nosso Caddy/túnel: vale o último endereço (o que o intermediário acrescentou).
    assert.equal(ipDoPedido(pedido('172.18.0.3', '1.2.3.4, 198.51.100.7')), '198.51.100.7');
    assert.equal(ipDoPedido(pedido('::ffff:127.0.0.1')), '127.0.0.1');
});

test('hostInterno bloqueia IPv6-mapped IPv4, DNS rebinding, hex/octal e faixas reservadas', () => {
    for (const host of [
        '[::1]', '::', '0.0.0.0', '::ffff:127.0.0.1', '[::ffff:127.0.0.1]',
        '::ffff:7f00:1', '::ffff:169.254.169.254', '0:0:0:0:0:ffff:10.0.0.1',
        '2130706433', '0x7f000001', '0177.0.0.1', '127.1', '224.0.0.1', '255.255.255.255',
        '169.254.169.254.nip.io', '127.0.0.1.sslip.io', 'sub.localtest.me', 'teste.lvh.me',
        'roteador.home.arpa', 'nas.lan'
    ]) {
        assert.equal(seguranca.hostInterno(host), true, host + ' precisa ser bloqueado');
    }
});

test('compararSegredo e escaparHtml protegem contra timing attack e XSS', () => {
    assert.equal(seguranca.compararSegredo('segredo-123', 'segredo-123'), true);
    assert.equal(seguranca.compararSegredo('segredo-123', 'segredo-124'), false);
    assert.equal(seguranca.compararSegredo('', 'segredo-123'), false);
    assert.equal(seguranca.compararSegredo('segredo-123', ''), false);
    assert.equal(seguranca.escaparHtml('<img src=x onerror="alert(\'xss\')">&'), '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;');
    assert.equal(seguranca.paginaDeEntrada({ erro: '<script>alert(1)</script>' }).includes('<script>alert(1)</script>'), false);
});

test('central e rotas de aparelhos escapam XSS, bloqueiam acesso indevido e barram SSRF em /api/converter', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-rotas-seg-'));
    const arqAcessos = path.join(pasta, 'acessos.json');
    const arqAut = path.join(pasta, 'autorizados.json');
    const portao = seguranca.criarPortao({ codigo: 'codigo-familia', arquivo: arqAut });
    const rotasGet = new Map(), rotasPost = new Map();
    const appFalso = {
        get: (c, ...fn) => rotasGet.set(c, fn[fn.length - 1]),
        post: (c, ...fn) => rotasPost.set(c, fn[fn.length - 1]),
    };
    const midia = require('./midia-proxy');
    require('./rotas/acessos')(appFalso, {
        ARQ_ACESSOS: arqAcessos,
        LOCAL_CONFIG: { centralKey: 'chave-super-secreta', acessoCodigo: 'codigo-familia' },
        fs,
        seguranca,
        portao,
    });
    require('./rotas/aparelhos')(appFalso, {
        portao,
        seguranca,
        LOCAL_CONFIG: { centralKey: 'chave-super-secreta' },
    });
    require('./rotas/downloads')(appFalso, {
        LOCAL_CONFIG: {},
        fs,
        midia,
        seguranca,
    });

    // 1. Stored XSS em /api/acesso -> /central é neutralizado com escape HTML
    const resAcesso = resposta();
    rotasPost.get('/api/acesso')(pedido({
        method: 'POST',
        body: {
            nome: '<img src=x onerror=alert(1)>',
            aparelho: '<script>evil()</script>',
            assistindo: '"><svg onload=alert(2)>',
            dispositivo: 'disp-xss',
        }
    }), resAcesso);
    assert.equal(resAcesso.statusCode, 200);

    const resCentral = resposta();
    rotasGet.get('/central')(pedido({ query: { chave: 'chave-super-secreta' } }), resCentral);
    assert.equal(resCentral.statusCode, 200);
    assert.equal(String(resCentral.corpo).includes('<script>evil()</script>'), false);
    assert.equal(String(resCentral.corpo).includes('<img src=x'), false);
    assert.match(String(resCentral.corpo), /&lt;img src=x onerror=alert\(1\)&gt;/);

    // 2. Aparelho comum de fora não pode listar tokens nem bloquear dispositivos
    const resDispComum = resposta();
    rotasGet.get('/api/dispositivos')(pedido({
        socket: { remoteAddress: '203.0.113.55' },
        dispositivoAutorizado: { dispositivo: 'celular-comum', nome: 'Visitante' },
    }), resDispComum);
    assert.equal(resDispComum.statusCode, 403);

    // A Central autenticada consegue listar normalmente
    const resDispCentral = resposta();
    rotasGet.get('/api/dispositivos')(pedido({
        socket: { remoteAddress: '203.0.113.55' },
        dispositivoAutorizado: { dispositivo: 'central-conecta-tv', nome: 'Central Conecta TV' },
    }), resDispCentral);
    assert.equal(resDispCentral.statusCode, 200);

    // 3. /api/converter bloqueia portas internas arbitrárias (ex.: 127.0.0.1:4100) e hosts não autorizados
    const resConvInterna = resposta();
    rotasGet.get('/api/converter')(pedido({
        socket: { localPort: 3000 },
        query: { url: midia.base64url('http://127.0.0.1:4100/api/status') },
    }), resConvInterna);
    assert.equal(resConvInterna.statusCode, 400);

    const resConvHostEstranho = resposta();
    rotasGet.get('/api/converter')(pedido({
        socket: { localPort: 3000 },
        query: { url: midia.base64url('https://atacante-qualquer.example.com/video.mkv') },
    }), resConvHostEstranho);
    assert.equal(resConvHostEstranho.statusCode, 400);

    // 4. midia.liberarHost nunca libera host interno
    midia.liberarHost('169.254.169.254');
    midia.liberarHost('127.0.0.1');
    assert.equal(midia.hostPermitido('169.254.169.254'), false);
    assert.equal(midia.hostPermitido('127.0.0.1'), false);

    fs.rmSync(pasta, { recursive: true, force: true });
});
