'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable, PassThrough } = require('node:stream');
const http = require('node:http');
const vm = require('node:vm');
const midia = require('../midia-proxy');
const { criarVerificadorNavegador } = require('./verificar-navegador');

const tick = () => new Promise(resolve => setImmediate(resolve));
function promessaManual() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function ate(condicao) {
    for (let i = 0; i < 100; i++) { if (condicao()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.fail('a operação não terminou no prazo do teste');
}

function ambiente(opcoes = {}) {
    const stats = { lancamentos: 0, ativos: 0, pico: 0, fechados: 0, mortos: 0, servidores: [], scripts: [] };
    const paginas = [];
    const novoBrowser = () => {
        const pag = new EventEmitter();
        Object.assign(pag, {
            setUserAgent: async () => {}, setViewport: async () => {}, setContent: async () => {}, addScriptTag: async () => {},
            goto: async (url, opts) => { if (opcoes.goto) await opcoes.goto(pag, url, opts); },
            evaluate: async script => {
                // Confere o código que realmente será executado pelo Chromium.
                new vm.Script(script);
                stats.scripts.push(script);
                if (opcoes.evaluate) return opcoes.evaluate(pag, script);
                return { tocou: true, largura: 1920, altura: 1080, tempo: 1.5, pronto: 4, eventos: [] };
            },
        });
        if (opcoes.cdp) {
            pag.sessao = new EventEmitter();
            pag.sessao.send = async metodo => { stats.cdpMetodo = metodo; };
            pag.sessao.detach = async () => { stats.cdpFechada = true; };
            pag.createCDPSession = async () => pag.sessao;
        }
        paginas.push(pag);
        const browser = new EventEmitter();
        let fechado = false;
        browser.newPage = async () => pag;
        browser.close = async () => {
            if (opcoes.close) await opcoes.close();
            if (!fechado) { fechado = true; stats.ativos--; stats.fechados++; }
        };
        browser.process = () => ({ killed: false, kill: () => { if (!fechado) { fechado = true; stats.ativos--; stats.mortos++; } } });
        stats.ativos++; stats.pico = Math.max(stats.pico, stats.ativos);
        return browser;
    };
    const puppeteer = { launch: async opts => { stats.lancamentos++; stats.launchOptions = opts; return opcoes.launch ? opcoes.launch(novoBrowser, opts) : novoBrowser(); } };
    const robo = criarVerificadorNavegador({
        carregarPuppeteer: () => opcoes.semBiblioteca ? null : puppeteer,
        acharNavegador: () => opcoes.semChrome ? '' : 'chrome-de-teste',
        fs: { readFileSync: () => '' },
        http: { createServer: handler => { const servidor = http.createServer(handler); stats.servidores.push(servidor); return servidor; } },
        esperar: opcoes.esperar || (async ms => { stats.esperaMs = ms; await tick(); }),
        axios: opcoes.axios || { get: async () => { throw new Error('não há acesso externo neste teste'); } },
        limites: { abrirMs: 100, fecharMs: 30, etapaMs: 100, respostaMs: 30, filaMs: 500, encaminharMs: 500, ...opcoes.limites },
    });
    return { robo, stats, paginas, novoBrowser };
}

function pedido(url, metodo = 'GET', corpo = '') { return { url: () => url, method: () => metodo, postData: () => corpo }; }
function resposta(url, corpo, headers = {}) {
    return { url: () => url, headers: () => ({ 'content-type': 'application/json', ...headers }), text: async () => corpo };
}
function solicitar(porta, rota, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port: porta, path: rota, headers, agent: false }, res => {
            const pedacos = [];
            res.on('data', pedaco => pedacos.push(pedaco));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: Buffer.concat(pedacos).toString('utf8') }));
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}
const rota = url => '/api/hls?u=' + midia.base64url(url);

test('indisponibilidade é explícita e não cria servidor ou Chromium', async () => {
    for (const opcoes of [{ semBiblioteca: true }, { semChrome: true }]) {
        const { robo, stats } = ambiente(opcoes);
        const tocar = await robo.tocarNoNavegador('https://fonte.test/video.m3u8');
        assert.equal(tocar.semRobo, true);
        assert.equal(tocar.tocou, false);
        const espiar = await robo.espionarPagina('https://fonte.test/');
        assert.equal(espiar.semRobo, true);
        assert.equal(espiar.ok, false);
        assert.equal(stats.lancamentos, 0);
        assert.equal(stats.servidores.length, 0);
        assert.ok(robo.erroDoRobo());
    }
});

test('tocar e espionar dividem uma vaga inclusive durante o encerramento', async () => {
    const liberacao = promessaManual();
    let primeiro = true;
    const { robo, stats } = ambiente({ esperar: async () => { if (primeiro) { primeiro = false; await liberacao.promise; } } });
    const a = robo.espionarPagina('https://um.test/');
    await ate(() => stats.lancamentos === 1);
    const b = robo.tocarNoNavegador('https://dois.test/video.m3u8');
    const c = robo.espionarPagina('https://tres.test/');
    await tick();
    assert.equal(stats.lancamentos, 1);
    liberacao.resolve();
    const resultados = await Promise.all([a, b, c]);
    assert.equal(resultados[0].ok, true);
    assert.equal(resultados[1].tocou, true);
    assert.equal(resultados[2].ok, true);
    assert.equal(stats.pico, 1);
    assert.equal(stats.fechados, 3);
    assert.equal(stats.ativos, 0);
    assert.ok(stats.servidores.every(s => !s.listening));
});

test('fila cheia e cancelamento de quem espera não criam browser nem depreciam fonte', async () => {
    const inicio = promessaManual(), fim = promessaManual();
    const { robo, stats } = ambiente({ limites: { fila: 1 }, esperar: async () => { inicio.resolve(); await fim.promise; } });
    const a = robo.espionarPagina('https://um.test/');
    await inicio.promise;
    const controller = new AbortController();
    const b = robo.espionarPagina('https://dois.test/', { signal: controller.signal });
    const cheia = await robo.tocarNoNavegador('https://tres.test/video.mp4');
    assert.equal(cheia.semRobo, true);
    assert.match(cheia.erro, /fila.*cheia/);
    controller.abort();
    const cancelada = await b;
    assert.equal(cancelada.semRobo, true);
    assert.match(cancelada.erro, /cancelada/);
    fim.resolve(); await a;
    assert.equal(stats.lancamentos, 1);
    assert.equal(stats.ativos, 0);
});

test('tempo na fila termina com diagnóstico e a vaga continua utilizável', async () => {
    const inicio = promessaManual(), fim = promessaManual();
    const { robo, stats } = ambiente({ limites: { filaMs: 15 }, esperar: async () => { inicio.resolve(); await fim.promise; } });
    const a = robo.espionarPagina('https://um.test/'); await inicio.promise;
    const b = await robo.espionarPagina('https://dois.test/');
    assert.equal(b.semRobo, true); assert.match(b.erro, /espera/);
    fim.resolve(); await a;
    assert.equal((await robo.tocarNoNavegador('https://video.test/file.mp4')).tocou, true);
    assert.equal(stats.pico, 1);
});

test('falha ao lançar fecha encaminhador e mantém motivo do robô', async () => {
    const { robo, stats } = ambiente({ launch: async () => { throw new Error('launch falhou'); } });
    const resultado = await robo.tocarNoNavegador('https://fonte.test/video.m3u8');
    assert.equal(resultado.tocou, false);
    assert.equal(resultado.semRobo, true);
    assert.match(resultado.erro, /launch falhou/);
    assert.match(robo.erroDoRobo(), /launch falhou/);
    assert.ok(stats.servidores.every(s => !s.listening));
});

test('lançamento tardio após prazo fecha antes de conceder a próxima vaga', async () => {
    const lancamento = promessaManual();
    let primeiro = true;
    const { robo, stats, novoBrowser } = ambiente({ limites: { abrirMs: 15 }, launch: async criar => {
        if (primeiro) { primeiro = false; return lancamento.promise; }
        return criar();
    } });
    const a = await robo.espionarPagina('https://um.test/');
    assert.equal(a.semRobo, true); assert.match(a.erro, /prazo/);
    const b = robo.espionarPagina('https://dois.test/');
    await tick(); assert.equal(stats.lancamentos, 1);
    lancamento.resolve(novoBrowser());
    assert.equal((await b).ok, true);
    assert.equal(stats.pico, 1); assert.equal(stats.fechados, 2);
});

test('browser que não fecha é encerrado pelo próprio processo sem prender fila', async () => {
    const { robo, stats } = ambiente({ close: () => new Promise(() => {}), limites: { fecharMs: 10 } });
    assert.equal((await robo.espionarPagina('https://um.test/')).ok, true);
    assert.equal((await robo.espionarPagina('https://dois.test/')).ok, true);
    assert.equal(stats.mortos, 2); assert.equal(stats.ativos, 0); assert.equal(stats.pico, 1);
});

test('falha em navegação sem pedidos retorna erro e encerra todos os recursos', async () => {
    const { robo, stats } = ambiente({ goto: async () => { throw new Error('navegação falhou'); } });
    const spy = await robo.espionarPagina('https://fonte.test/');
    assert.equal(spy.ok, false); assert.match(spy.erro, /navegação/);
    const play = await robo.tocarNoNavegador('https://fonte.test/video.m3u8');
    assert.equal(play.tocou, false);
    assert.equal(stats.ativos, 0); assert.equal(stats.fechados, 2);
    assert.ok(stats.servidores.every(s => !s.listening));
});

test('cancelamento de etapa ativa fecha o browser e permite nova sondagem', async () => {
    const inicio = promessaManual();
    let primeiro = true;
    const { robo, stats } = ambiente({ goto: async () => { if (primeiro) { primeiro = false; inicio.resolve(); await new Promise(() => {}); } } });
    const controller = new AbortController();
    const tarefa = robo.tocarNoNavegador('https://fonte.test/video.m3u8', { signal: controller.signal });
    await inicio.promise; controller.abort();
    const resultado = await tarefa;
    assert.equal(resultado.semRobo, true); assert.match(resultado.erro, /cancelada/);
    assert.equal((await robo.espionarPagina('https://outra.test/')).ok, true);
    assert.equal(stats.ativos, 0); assert.ok(stats.servidores.every(s => !s.listening));
});

test('coleta mantém vídeos, método POST e corpo de API; limita conjuntos e tempo solicitado', async () => {
    const { robo, stats } = ambiente({ goto: async pag => {
        pag.emit('request', pedido('https://fonte.test/player', 'POST', '{"id":"publico"}'));
        pag.emit('response', resposta('https://fonte.test/api/player', '{"url":"https://cdn.test/video.m3u8"}'));
        for (let i = 0; i < 200; i++) {
            pag.emit('request', pedido(`https://fonte.test/api/${i}`));
            pag.emit('request', pedido(`https://cdn.test/${i}.mp4`));
        }
    } });
    const r = await robo.espionarPagina('https://fonte.test/', { segundos: Infinity });
    assert.equal(r.ok, true); assert.equal(r.pedidos.length, 120); assert.equal(r.videos.length, 10); assert.equal(r.chamadas.length, 20);
    assert.equal(r.chamadas[0].metodo, 'POST'); assert.equal(r.chamadas[0].corpo, '{"id":"publico"}');
    assert.equal(r.api.length, 1); assert.match(r.api[0].corpo, /video.m3u8/);
    assert.equal(stats.esperaMs, 18000);
    await robo.espionarPagina('https://fonte.test/', { segundos: 1000 });
    assert.equal(stats.esperaMs, 45000);
});

test('corpo declarado grande não é lido e só duas leituras ocorrem simultaneamente', async () => {
    let lidos = 0, ativos = 0, pico = 0;
    const pendentes = [];
    const { robo } = ambiente({ goto: async pag => {
        const enorme = resposta('https://fonte.test/api/grande', '', { 'content-length': '400001' });
        enorme.text = async () => { assert.fail('corpo grande não deve ser lido'); };
        pag.emit('response', enorme);
        for (let i = 0; i < 10; i++) {
            const resp = resposta(`https://fonte.test/api/${i}`, '');
            resp.text = async () => { lidos++; ativos++; pico = Math.max(pico, ativos); const p = promessaManual(); pendentes.push(p); await p.promise; ativos--; return '{"url":"https://cdn.test/a.mp4"}'; };
            pag.emit('response', resp);
        }
    }, esperar: async () => { await tick(); for (const p of pendentes) p.resolve(); await tick(); } });
    const r = await robo.espionarPagina('https://fonte.test/');
    assert.equal(r.ok, true); assert.equal(lidos, 2); assert.equal(pico, 2); assert.equal(r.api.length, 2);
});

test('leitura de API travada termina e respostas tardias não mudam o resultado', async () => {
    const corpo = promessaManual();
    const { robo, stats } = ambiente({ limites: { respostaMs: 10 }, goto: async pag => {
        const resp = resposta('https://fonte.test/api/player', ''); resp.text = () => corpo.promise; pag.emit('response', resp);
    } });
    const r = await robo.espionarPagina('https://fonte.test/');
    assert.equal(r.ok, true); assert.deepEqual(r.api, []); assert.equal(stats.ativos, 0);
    corpo.resolve('{"url":"https://cdn.test/tarde.mp4"}'); await tick(); assert.deepEqual(r.api, []);
});

test('script real só aprova vídeo com imagem e avanço; para HLS após medir', async () => {
    for (const [largura, tempo] of [[0, 1.5], [1920, 1], [1920, 1.5]]) {
        let pausado = false, destruido = false, carregado = false, relogio = 0;
        const video = { videoWidth: largura, videoHeight: largura ? 1080 : 0, currentTime: tempo, readyState: 4,
            style: {}, play: () => Promise.resolve(), pause: () => { pausado = true; }, removeAttribute: () => {}, load: () => { carregado = true; } };
        function Hls() { this.on = () => {}; this.loadSource = () => {}; this.attachMedia = () => {}; this.destroy = () => { destruido = true; }; }
        Hls.Events = { ERROR: 'error' }; Hls.isSupported = () => true;
        const { robo } = ambiente({ evaluate: async (_, script) => vm.runInNewContext(script, {
            document: { createElement: () => video, body: { append: () => {} } }, window: { Hls },
            Date: { now: () => relogio }, setTimeout: (fn, ms) => { relogio += ms; fn(); },
        }) });
        const r = await robo.tocarNoNavegador('https://fonte.test/lista.m3u8', { segundos: 4 });
        assert.equal(r.tocou, Boolean(largura && tempo > 1)); assert.equal(r.largura, largura);
        assert.equal(pausado, true); assert.equal(destruido, true); assert.equal(carregado, true);
    }
});

test('dados sem Content-Length também encerram o espião ao ultrapassar orçamento', async () => {
    const { robo, stats } = ambiente({ cdp: true, limites: { espiaoBytes: 10 }, goto: async pag => {
        pag.emit('request', pedido('https://fonte.test/api/player'));
        pag.sessao.emit('Network.dataReceived', { dataLength: 4 });
        pag.sessao.emit('Network.dataReceived', { dataLength: 7 });
    } });
    const r = await robo.espionarPagina('https://fonte.test/');
    assert.equal(r.ok, false); assert.equal(r.semRobo, true); assert.match(r.erro, /orçamento de dados/);
    assert.equal(stats.cdpMetodo, 'Network.enable'); assert.equal(stats.cdpFechada, true); assert.equal(stats.ativos, 0);
});

test('proxy loopback mantém referer/range/status e reescreve playlist do mesmo host', async t => {
    const requisicoes = [];
    const { robo } = ambiente({ axios: { get: async (url, opts) => {
        requisicoes.push({ url, opts });
        if (/m3u8/.test(url)) return { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, data: Readable.from([Buffer.from('#EXTM3U\nsegmento.ts\n')]) };
        return { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/3', 'content-length': '3' }, data: Readable.from([Buffer.from('abc')]) };
    } } });
    const proxy = await robo.criarEncaminhador(); t.after(() => proxy.fechar());
    const ref = 'https://fonte.test/';
    const lista = await solicitar(proxy.porta, rota('https://cdn-teste.test/lista.m3u8') + '&r=' + midia.base64url(ref));
    assert.equal(lista.status, 200); assert.match(lista.texto, /\/api\/hls\?u=/); assert.equal(requisicoes[0].opts.headers.Referer, ref);
    const arquivo = await solicitar(proxy.porta, rota('https://cdn-teste.test/file.mp4'), { Range: 'bytes=0-2' });
    assert.equal(arquivo.status, 206); assert.equal(arquivo.texto, 'abc'); assert.equal(arquivo.headers['content-range'], 'bytes 0-2/3');
    assert.equal(requisicoes[1].opts.headers.Range, 'bytes=0-2');
});

test('playlist grande é interrompida antes de acumular corpo ilimitado', async t => {
    const stream = Readable.from([Buffer.from('12345'), Buffer.from('67890')]);
    let signal;
    const { robo } = ambiente({ limites: { playlistBytes: 8 }, axios: { get: async (_, opts) => {
        signal = opts.signal; return { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, data: stream };
    } } });
    const proxy = await robo.criarEncaminhador(); t.after(() => proxy.fechar());
    const r = await solicitar(proxy.porta, rota('https://cdn.test/lista.m3u8'));
    assert.equal(r.status, 502); assert.equal(signal.aborted, true); assert.equal(stream.destroyed, true);
});

test('fechar proxy aborta pedido pendente e a resposta que chegar depois é destruída', async () => {
    const iniciado = promessaManual(), concluido = promessaManual();
    let signal;
    const { robo } = ambiente({ axios: { get: async (_, opts) => { signal = opts.signal; iniciado.resolve(); return concluido.promise; } } });
    const proxy = await robo.criarEncaminhador();
    const r = solicitar(proxy.porta, rota('https://cdn.test/file.mp4')).catch(() => null);
    await iniciado.promise; await proxy.fechar();
    assert.equal(signal.aborted, true); assert.equal(proxy.servidor.listening, false);
    const stream = new PassThrough();
    concluido.resolve({ status: 200, headers: { 'content-type': 'video/mp4' }, data: stream });
    await ate(() => stream.destroyed); await r;
    await proxy.fechar(); // fechamento idempotente
});

test('desistência do cliente aborta stream do fornecedor', async t => {
    const stream = new PassThrough();
    let signal;
    const { robo } = ambiente({ axios: { get: async (_, opts) => { signal = opts.signal; return { status: 200, headers: { 'content-type': 'video/mp4' }, data: stream }; } } });
    const proxy = await robo.criarEncaminhador(); t.after(() => proxy.fechar());
    const cliente = http.get({ hostname: '127.0.0.1', port: proxy.porta, path: rota('https://cdn.test/file.mp4'), agent: false });
    cliente.on('error', () => {});
    await ate(() => Boolean(signal)); stream.write(Buffer.from('inicio'));
    await new Promise(resolve => cliente.once('response', res => { res.on('error', () => {}); res.resume(); resolve(); }));
    cliente.destroy(); await ate(() => signal.aborted);
    assert.equal(stream.destroyed, true);
});

test('orçamento de pedidos do proxy impede novas chamadas externas', async t => {
    let chamadas = 0;
    const { robo } = ambiente({ limites: { pedidosProxy: 1 }, axios: { get: async () => { chamadas++; throw new Error('rede indisponível'); } } });
    const proxy = await robo.criarEncaminhador(); t.after(() => proxy.fechar());
    assert.equal((await solicitar(proxy.porta, rota('https://cdn.test/file.mp4'))).status, 502);
    assert.equal((await solicitar(proxy.porta, rota('https://cdn.test/file.mp4'))).status, 503);
    assert.equal(chamadas, 1);
});

test('orçamento de bytes corta mídia e recusa novos downloads da sondagem', async t => {
    let chamadas = 0, signal;
    const { robo } = ambiente({ limites: { midiaBytes: 4 }, axios: { get: async (_, opts) => {
        chamadas++; signal = opts.signal;
        return { status: 200, headers: { 'content-type': 'video/mp4' }, data: Readable.from([Buffer.from('12345678')]) };
    } } });
    const proxy = await robo.criarEncaminhador(); t.after(() => proxy.fechar());
    await assert.rejects(solicitar(proxy.porta, rota('https://cdn.test/file.mp4')));
    assert.equal(signal.aborted, true);
    assert.equal((await solicitar(proxy.porta, rota('https://cdn.test/file.mp4'))).status, 503);
    assert.equal(chamadas, 1);
});

test('prazo do proxy aborta conexão que o fornecedor mantém pendente', async t => {
    let signal;
    const { robo } = ambiente({ limites: { encaminharMs: 15 }, axios: { get: async (_, opts) => { signal = opts.signal; return new Promise(() => {}); } } });
    const proxy = await robo.criarEncaminhador(); t.after(() => proxy.fechar());
    await assert.rejects(solicitar(proxy.porta, rota('https://cdn.test/file.mp4')));
    assert.equal(signal.aborted, true);
});

test('erro ao abrir porta rejeita sem aguardar para sempre', async () => {
    const servidor = new EventEmitter();
    servidor.listening = false;
    servidor.listen = () => { setImmediate(() => servidor.emit('error', new Error('porta indisponível'))); };
    const robo = criarVerificadorNavegador({ http: { createServer: () => servidor } });
    await assert.rejects(robo.criarEncaminhador(), /porta indisponível/);
});
