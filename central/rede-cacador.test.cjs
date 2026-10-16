const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarRede, enderecoPublico, esperaPedida, comRodada } = require('./rede-cacador');
const pausa = ms => new Promise(r => setTimeout(r, ms));

test('consultas respeitam limite global e não acumulam pedidos para o mesmo domínio', async () => {
    let ativos = 0, pico = 0; const hosts = new Map();
    const rede = criarRede({ simultaneos: 2, transporte: async url => {
        const host = new URL(url).hostname;
        assert.equal(hosts.get(host) || 0, 0); hosts.set(host, 1);
        pico = Math.max(pico, ++ativos); await pausa(5); ativos--; hosts.delete(host);
        return { status: 200, data: 'ok' };
    } });
    await Promise.all(['a.test/1', 'a.test/2', 'b.test/1', 'c.test/1'].map(url => rede.get('https://' + url)));
    assert.equal(pico, 2); assert.equal(rede.resumo().ativas, 0); assert.equal(rede.resumo().aguardando, 0);
});

test('429 pausa domínio e seus pedidos na fila sem bloquear outros fornecedores', async () => {
    let instante = 1000, chamadas = 0;
    const rede = criarRede({ agora: () => instante, transporte: async url => {
        chamadas++; return { status: url.includes('a.test') ? 429 : 200, headers: { 'retry-after': '120' } };
    } });
    await assert.rejects(rede.get('https://a.test/1'), { code: 'FORNECEDOR_EM_PAUSA' });
    await assert.rejects(rede.get('https://a.test/2'), { code: 'FORNECEDOR_EM_PAUSA' });
    assert.equal(chamadas, 1); await rede.get('https://b.test/1');
    instante += 121000; await assert.rejects(rede.get('https://a.test/3'), { code: 'FORNECEDOR_EM_PAUSA' });
    assert.equal(chamadas, 3);
    assert.equal(esperaPedida('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('2026-10-21T07:27:00Z')), 60000);
});

test('cancelar rodada remove pedidos aguardando e interrompe o transporte ativo', async () => {
    const controller = new AbortController(); let chamadas = 0;
    const rede = criarRede({ simultaneos: 1, transporte: (url, opcoes) => {
        chamadas++; return new Promise((resolve, reject) => opcoes.signal.addEventListener('abort', () => reject(Error('abortado')), { once: true }));
    } });
    const resultados = comRodada({ signal: controller.signal, fim: Date.now() + 1000 }, () =>
        Promise.allSettled([rede.get('https://a.test/1'), rede.get('https://b.test/1')]));
    controller.abort(); const dados = await resultados; await pausa(1);
    assert.equal(chamadas, 1); assert.ok(dados.every(d => d.status === 'rejected'));
    assert.equal(rede.resumo().aguardando, 0); assert.equal(rede.resumo().ativas, 0);
});

test('descoberta recusa rede interna e redirecionamento com credenciais, limita resposta', async () => {
    for (const url of ['http://127.0.0.1/', 'http://192.168.1.4/', 'file:///c:/a', 'https://user:senha@site.test/']) assert.throws(() => enderecoPublico(url));
    const rede = criarRede({ transporte: async (url, opcoes) => {
        assert.equal(opcoes.maxContentLength, 4 * 1024 * 1024);
        assert.throws(() => opcoes.beforeRedirect({ href: 'http://localhost/a' }));
        const redirect = { href: 'https://b.test/a', headers: { Authorization: 'segredo', Cookie: 'sessao', Referer: 'https://a.test/' } };
        opcoes.beforeRedirect(redirect); assert.equal(redirect.headers.Authorization, undefined); assert.equal(redirect.headers.Cookie, undefined);
        return { status: 200 };
    } }); await rede.get('https://a.test/a');
});

test('sitemap e deduplicação mantêm molde e evidências sem seguir endereços externos', () => {
    const { linksDoMapa, juntarCandidatas } = require('./varredor');
    assert.deepEqual(linksDoMapa('<loc>https://site.test/filme/123</loc><loc>https://outro.test/a</loc><loc>http://127.0.0.1/a</loc>', 'https://site.test'), ['https://site.test/filme/123']);
    const [item] = juntarCandidatas([{ url: 'https://site.test/#top', origem: 'mapa', molde: 'https://site.test/{id}', detalhes: { tipo: 'movie' } }], [{ url: 'https://site.test/', origem: 'github', detalhes: { confirmados: ['tt123'] } }]);
    assert.deepEqual(item.origens, ['mapa', 'github']); assert.equal(item.molde, 'https://site.test/{id}');
    assert.deepEqual(item.detalhes, { tipo: 'movie', confirmados: ['tt123'] });
});

test('varredura fora do orçamento informa resultado parcial e encerra as próximas consultas', async t => {
    const rede = require('./rede-cacador'), varredor = require('./varredor'); let pedidos = 0;
    t.mock.method(rede, 'get', async () => { pedidos++; await pausa(15); rede.checarRodada(); return {status:200,data:''}; });
    const itens = await varredor.varrerTudo({prazoMs:5});
    assert.equal(itens.parcial, true); assert.ok(pedidos <= 4, 'não iniciou novas consultas depois de pausar');
});
