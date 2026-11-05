'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pc = require('./cacador-pc.cjs');
const cacada = require('./cacada-titulo');

const H = 3600000;
test('espera entre caçadas cresce sem resultado e volta a 6 h com falha nova', () => {
    const agora = 100 * 24 * H;
    assert.equal(pc.podeCacar(undefined, { agora }), true);
    assert.equal(pc.podeCacar({ em: agora - 7 * H, vezes: 1 }, { agora }), true);
    assert.equal(pc.podeCacar({ em: agora - 7 * H, vezes: 2 }, { agora }), false);   // precisa 12 h
    assert.equal(pc.podeCacar({ em: agora - 13 * H, vezes: 2 }, { agora }), true);
    assert.equal(pc.podeCacar({ em: agora - 30 * H, vezes: 4 }, { agora }), false);  // precisa 48 h
    assert.equal(pc.podeCacar({ em: agora - 7 * H, vezes: 4 }, { agora, ultimaFalha: agora - H }), true);
    assert.equal(pc.podeCacar({ em: agora - 8 * 24 * H, vezes: 20 }, { agora }), true); // teto de 7 dias
    assert.equal(pc.podeCacar(agora - 7 * H, { agora }), true); // formato antigo (número)
    const estado = { cacados: { a: agora - H } };
    pc.anotarCacada(estado, 'a', false, agora); assert.deepEqual(estado.cacados.a, { em: agora, vezes: 2 });
    pc.anotarCacada(estado, 'a', true, agora); assert.equal(estado.cacados.a.vezes, 0);
});

test('títulos para melhorar: abriram abaixo de 1080p; série conta uma vez; 1080p em outra sessão tira da lista', () => {
    const agora = Date.parse('2026-11-02T12:00:00Z');
    const em = h => new Date(agora - h * H).toISOString();
    const sessoes = [
        { id: '1405', titulo: 'Dexter · T1 E2', criadoEm: em(2), tentativas: [{ fonteId: 'froststream', resultado: 'fechou', resolucao: '720p' }] },
        { id: '1405', titulo: 'Dexter · T1 E1', criadoEm: em(3), tentativas: [{ fonteId: 'froststream', resultado: 'fechou', resolucao: '720p' }] },
        { id: '70160', titulo: 'Jogos Vorazes', criadoEm: em(5), tentativas: [{ fonteId: 'x', resultado: 'abriu', resolucao: '720p' }] },
        { id: '550', titulo: 'Clube da Luta', criadoEm: em(5), tentativas: [{ fonteId: 'x', resultado: 'fechou', resolucao: '720p' }] },
        { id: '550', titulo: 'Clube da Luta', criadoEm: em(6), tentativas: [{ fonteId: 'y', resultado: 'fechou', resolucao: '1080p' }] },
        { id: '27205', titulo: 'A Origem', criadoEm: em(24 * 9), tentativas: [{ fonteId: 'x', resultado: 'fechou', resolucao: '480p' }] },
        { id: '603', titulo: 'Matrix', criadoEm: em(1), tentativas: [{ fonteId: '', resultado: 'falhou', resolucao: '' }] },
    ];
    const lista = pc.titulosParaMelhorar(sessoes, { agora, pedidos: [{ tipo: 'movie', tmdbId: '70160', titulo: 'JV' }, { tipo: 'movie', tmdbId: '11', titulo: 'Star Wars' }] });
    assert.deepEqual(lista.map(a => a.chave).sort(), ['qualidade:movie:11', 'qualidade:movie:70160', 'qualidade:tv:1405']);
    assert.equal(lista.find(a => a.tmdbId === '1405').episodio, 2);
});

test('caçada de qualidade: addon que só tem o título em 720p não vira ficha', async () => {
    const validadas = [];
    const deps = {
        buscarJson: async url => {
            if (/external_ids/.test(url)) return { imdb_id: 'tt0000001' };
            if (/catalog|addons|manifest/.test(url)) return null;
            if (/stream\/movie\/tt0000001/.test(url)) return { streams: [{ name: 'Dublado 720p', title: '🇧🇷 Dublado', url: 'https://cdn.a.example/v.mp4' }] };
            return null;
        },
        fixos: [{ nome: 'Addon A', base: 'https://a.example', tipos: ['movie', 'series'], brasileiro: true }],
        sondar: async () => ({ viva: true, altura: 720, dublado: true }),
        validar: async f => { validadas.push(f.nome); return { aprovada: true, ajustes: {}, provas: [] }; },
        registrarFicha: (p, f) => f, fichasAtuais: () => [], pastaDados: require('node:os').tmpdir() + '/cq-' + Date.now(),
    };
    const r = await cacada.cacarTitulo({ tipo: 'movie', tmdbId: '1', titulo: 'T' }, { ...deps, alturaMinima: 1080 });
    assert.equal(r.aprovadas.length, 0);
    assert.deepEqual(validadas, []);
    const normal = await cacada.cacarTitulo({ tipo: 'movie', tmdbId: '1', titulo: 'T' }, deps);
    assert.equal(normal.aprovadas.length, 1);
});

test('tela larga: 1920×800 conta como Full HD; 3840×1600 como 4K', () => {
    const { alturaEquivalente } = require('../politica-fontes');
    assert.equal(Math.round(alturaEquivalente(1920, 800)), 1080);
    assert.equal(Math.round(alturaEquivalente(3840, 1600)), 2160);
    assert.equal(Math.round(alturaEquivalente(1280, 720)), 720);
});

test('fonte já ativa revalidada: qualidade da ficha é atualizada', async () => {
    const fichasGravadas = [];
    const r = await cacada.verificarLinks(['https://bscine.provedor.net'], {
        buscarJson: async u => (u.endsWith('/manifest.json') ? { id: 'b', name: 'BsCine', resources: ['stream'], types: ['movie', 'series'] } : null),
        validar: async () => ({ aprovada: true, ajustes: { qualidade: '1080p', nota: 8 }, provas: [] }),
        fichasAtuais: () => [{ id: 'bscine', nome: 'BsCine', ativo: true, qualidade: '720p', urlMovie: 'https://bscine.provedor.net/stream/movie/{imdb}.json' }],
        registrarFicha: (p, f, a) => { fichasGravadas.push({ ...f, ...a.ajustes }); return f; },
    });
    assert.equal(r[0].status, 'já ativa');
    assert.equal(r[0].atualizada, true);
    assert.equal(fichasGravadas[0].id, 'bscine');
    assert.equal(fichasGravadas[0].qualidade, '1080p');
});

test('erros recentes: lista as tentativas com fonte e motivo; filtro pelo título', () => {
    const pc = require('./cacador-pc.cjs');
    const agora = Date.parse('2026-11-02T20:00:00Z');
    const sessoes = [
        { criadoEm: '2026-11-02T19:00:00Z', titulo: 'Dexter · T2 E3', nome: 'Larissa', aparelho: 'Android', versao: '2.13.136', tentativas: [
            { tentativa: 1, resultado: 'falhou', fonteId: 'froststream', motivo: 'a fonte não apresentou imagem', historico: [{ motivo: 'a fonte não apresentou imagem' }] },
            { tentativa: 2, resultado: 'falhou', fonte: 'BsCine', resolucao: '1080p', historico: [{ motivo: 'tempo limite' }] }] },
        { criadoEm: '2026-11-02T18:00:00Z', titulo: 'A Origem', tentativas: [{ tentativa: 1, resultado: 'abriu', fonteId: 'x', historico: [] }] },
    ];
    const todas = pc.errosRecentes(sessoes, { agora });
    assert.ok(todas[0].includes('Dexter · T2 E3') && todas[0].includes('Larissa'));
    assert.ok(todas.some(l => /froststream · a fonte não apresentou imagem/.test(l)));
    assert.ok(todas.some(l => /- tempo limite/.test(l)));
    assert.ok(!todas.some(l => /A Origem/.test(l)));
    assert.equal(pc.errosRecentes(sessoes, { agora, filtro: 'origem' }).length, 2);
});

test('certificado inválido: códigos de erro reconhecidos', () => {
    const vm = require('./verificar-midia');
    for (const c of ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED']) assert.equal(vm.erroDeCertificado(c), true, c);
    for (const c of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']) assert.equal(vm.erroDeCertificado(c), false, c);
});

test('ficha ativa com vídeo em certificado inválido é desligada (o app não toca)', async () => {
    const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
    process.env.CACADOR_PC_DADOS = pasta;
    delete require.cache[require.resolve('./cacador-pc.cjs')];
    const pc = require('./cacador-pc.cjs');
    const fichas = require('./perfis');
    fichas.gravar(pasta, { perfis: [
        { id: 'bscine', nome: 'BsCine', ativo: true, provas: [{ url: 'https://rfc-infinite.provedor.net/a.mp4' }, { url: 'https://rfc-infinite.provedor.net/b.mp4' }] },
        { id: 'boa', nome: 'Boa', ativo: true, provas: [{ url: 'https://ok.provedor.net/a.mp4' }] },
    ] });
    const desl = await pc.conferirCertificados({ checar: async u => (/rfc-infinite/.test(u) ? { ok: false, erro: 'SELF_SIGNED_CERT_IN_CHAIN' } : { ok: true }) });
    assert.deepEqual(desl, ['BsCine']);
    const lidas = fichas.ler(pasta).perfis;
    assert.equal(lidas.find(f => f.id === 'bscine').ativo, false);
    assert.equal(lidas.find(f => f.id === 'boa').ativo, true);
    delete process.env.CACADOR_PC_DADOS;
});

test('qualidade: 800p (tela larga) não é baixa; desligada por certificado não vira investigação', () => {
    const pc = require('./cacador-pc.cjs');
    const agora = Date.parse('2026-11-02T12:00:00Z');
    const sessoes = [{ id: '969681', titulo: 'Homem-Aranha', criadoEm: new Date(agora - 3600000).toISOString(), tentativas: [{ fonteId: 'x', resultado: 'fechou', resolucao: '800p' }] }];
    assert.equal(pc.titulosParaMelhorar(sessoes, { agora }).length, 0);
    const inv = require('./investigador');
    const casos = inv.casosAutomaticos({ fichas: [{ nome: 'BsCine', ativo: false, motivoDesligada: 'certificado https inválido', urlMovie: 'https://bscine.x.net/stream/movie/{imdb}.json' }] });
    assert.equal(casos.length, 0);
});

test('StreamUnion (debrid de outra pessoa) é recusado; Zeus (só anime) é aprovado com animes dublados', async () => {
    const cacada = require('./cacada-titulo');
    const manifests = {
        'https://union.provedor.net': { id: 'u', name: 'StreamUnion', resources: ['stream'], types: ['movie', 'series'] },
        'https://zeus.provedor.net': { id: 'z', name: 'Zeus', description: 'animes dublados', resources: ['stream'], types: ['movie', 'series'], catalogs: [{ type: 'series', name: 'Animes em lançamento' }] },
    };
    const buscarJson = async u => {
        const base = u.split(/\/(manifest\.json|stream\/)/)[0];
        if (u.endsWith('/manifest.json')) return manifests[base];
        if (base === 'https://union.provedor.net') return { streams: [{ name: '4K', title: 'Zerphyx Fast · TorBox', url: 'https://union.provedor.net/r/1' }] };
        return { streams: [] };
    };
    const validadas = [];
    const validar = async (ficha, amostras) => { validadas.push(ficha.nome + ':' + amostras[0].titulo); return /Naruto/.test(amostras[0].titulo) ? { aprovada: true, ajustes: { qualidade: '1080p', nota: 8 }, provas: [] } : { aprovada: false, provas: [] }; };
    const registradas = [];
    const r = await cacada.verificarLinks(['https://union.provedor.net', 'https://zeus.provedor.net'], { buscarJson, validar, fichasAtuais: () => [], registrarFicha: (p, f, a) => { registradas.push(f); return { ...f, ...a.ajustes }; } });
    assert.match(r[0].detalhe, /TorBox|conta paga/);
    assert.equal(r[1].status, 'aprovada');
    assert.equal(registradas[0].soAnime, true);
    assert.deepEqual(registradas[0].tipos, ['tv']);
    assert.ok(!validadas.some(v => /^StreamUnion/.test(v)), 'o debrid nem chega a ser validado');
});
