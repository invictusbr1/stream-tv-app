'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cacada = require('./cacada-titulo');
const fichas = require('./perfis');

const CATALOGO = { addons: [
    { transportUrl: 'https://bestcine.example/manifest.json', manifest: { name: 'BestCine', description: 'Filmes e séries dublados', resources: ['stream'], types: ['movie', 'series'] } },
    { transportUrl: 'https://legendado.example/manifest.json', manifest: { name: 'Só Legendado', resources: ['stream'], types: ['series'] } },
    { transportUrl: 'https://adulto.example/manifest.json', manifest: { name: 'Adult Video HD', resources: ['stream'], types: ['movie'] } },
    { transportUrl: 'https://torrentio.example/manifest.json', manifest: { name: 'Torrentio', resources: ['stream'], types: ['movie', 'series'] } },
    { transportUrl: 'https://config.example/manifest.json', manifest: { name: 'Precisa configurar', resources: ['stream'], types: ['movie'], behaviorHints: { configurationRequired: true } } },
    { transportUrl: 'https://catalogo.example/manifest.json', manifest: { name: 'Só catálogo', resources: ['catalog'], types: ['movie'] } },
    { transportUrl: 'http://inseguro.example/manifest.json', manifest: { name: 'HTTP', resources: ['stream'], types: ['movie'] } },
] };

test('catálogo público: só addons de stream úteis, brasileiros primeiro, com cópia em disco', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cacada-'));
    try {
        let pedidos = 0;
        const buscarJson = async url => { pedidos++; return /strem\.io/.test(url) ? [] : CATALOGO; };
        const lista = await cacada.carregarCatalogo({ buscarJson, pastaDados: pasta, fixos: [{ nome: 'Fixo', base: 'https://fixo.example' }] });
        assert.deepEqual(lista.map(a => a.base).sort(), ['https://bestcine.example', 'https://fixo.example', 'https://legendado.example'].sort());
        assert.equal(lista[0].base, 'https://bestcine.example');
        const antes = pedidos;
        await cacada.carregarCatalogo({ buscarJson, pastaDados: pasta });
        assert.equal(pedidos, antes, 'a segunda leitura usa a cópia de 12 h');
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('streams úteis: dublado, http direto, sem aviso/cadastro/torrent', () => {
    const uteis = cacada.streamsUteis([
        { name: 'BestCine 1080p', title: 'Quem Ama Cuida T01·E137 Servidor Safira 🇧🇷 Dublado', url: 'http://bestcine.example/r/b' },
        { name: 'BestCine 720p', title: '🇧🇷 Dublado', url: 'https://bestcine.example/r/a' },
        { name: 'X 1080p', title: '🇺🇸 Legendado', url: 'https://x.example/v.mp4' },
        { name: 'PenguPlay', title: 'You must sign in 🇧🇷 Dublado', url: 'https://pengu.example/signin.mp4' },
        { name: 'Torrent 4K Dublado', infoHash: 'abc' },
        { name: 'Comet Dublado', title: 'OBSOLETE CONFIGURATION', url: 'https://comet.feels.legal' },
    ]);
    assert.deepEqual(uteis.map(u => u.url), ['https://bestcine.example/r/b', 'https://bestcine.example/r/a']);
    assert.equal(uteis[0].altura, 1080);
});

test('ficha do addon: molde por título para filme e série', () => {
    const ficha = cacada.fichaDoAddon({ nome: 'BestCine', base: 'https://bestcine.example', tipos: ['movie', 'series'] }, 'https://bestcine.example/');
    assert.equal(ficha.id, 'bestcine');
    assert.equal(ficha.urlTv, 'https://bestcine.example/stream/series/{imdb}:{temporada}:{episodio}.json');
    assert.equal(ficha.urlMovie, 'https://bestcine.example/stream/movie/{imdb}.json');
    assert.deepEqual(ficha.tipos.sort(), ['movie', 'tv']);
    assert.equal(ficha.ativo, false, 'só a validação liga a ficha');
});

test('caçada por título: acha o episódio que falhou, mede os espelhos e só registra o que a validação aprova', async () => {
    const respostas = {
        'https://bestcine.example/stream/series/tt42751057:1:137.json': { streams: [
            { name: 'BestCine 1080p', title: 'Athena 🇧🇷 Dublado', url: 'https://bestcine.example/r/morto' },
            { name: 'BestCine 1080p', title: 'Safira 🇧🇷 Dublado', url: 'https://bestcine.example/r/vivo' },
        ] },
        'https://legendado.example/stream/series/tt42751057:1:137.json': { streams: [{ name: '1080p', title: 'Legendado', url: 'https://legendado.example/v.mp4' }] },
    };
    const buscarJson = async url => {
        if (/addon_catalog|strem\.io/.test(url)) return /strem\.io/.test(url) ? [] : CATALOGO;
        if (/external_ids/.test(url)) return { imdb_id: 'tt42751057' };
        if (/api\.themoviedb\.org\/3\/tv\/306956\?/.test(url)) return { genres: [{ id: 10766 }], origin_country: ['BR'] };
        if (/discover\/tv/.test(url)) return { results: [] };
        if (respostas[url]) return respostas[url];
        throw new Error('sem resposta');
    };
    const sondados = [];
    const sondar = async url => { sondados.push(url); return /morto/.test(url) ? { viva: false } : { viva: true, altura: 1080, dublado: true, evidencia: 'faixa pt' }; };
    const registradas = [];
    let amostrasValidadas = null;
    const r = await cacada.cacarTitulo({ tipo: 'tv', tmdbId: '306956', temporada: 1, episodio: 137, titulo: 'Quem Ama Cuida · T1 E137' }, {
        buscarJson, sondar,
        validar: async (ficha, amostras) => { amostrasValidadas = amostras; return { aprovada: true, provas: [], ajustes: { ativo: true, qualidade: '1080p', nota: 8 } }; },
        registrarFicha: (pasta, ficha, avaliacao) => { const f = { ...ficha, ...avaliacao.ajustes }; registradas.push(f); return f; },
        fichasAtuais: () => [],
    });
    assert.equal(r.responderam.length, 1, 'só o addon com rótulo dublado conta');
    assert.deepEqual(sondados, ['https://bestcine.example/r/morto', 'https://bestcine.example/r/vivo'], 'espelho morto não derruba o addon');
    assert.equal(registradas.length, 1);
    assert.equal(registradas[0].id, 'bestcine');
    assert.equal(registradas[0].ativo, true);
    assert.equal(amostrasValidadas[0].episodio, 137, 'a primeira prova é o próprio episódio que falhou');
    assert.ok(amostrasValidadas.some(a => /Nobreza|Três Graças|Dona de Mim/.test(a.titulo)), 'novela é validada com outras novelas');
});

test('caçada: addon que o app já usa não vira ficha repetida; reprovado não é registrado', async () => {
    const buscarJson = async url => {
        if (/addon_catalog/.test(url)) return CATALOGO;
        if (/strem\.io/.test(url)) return [];
        if (/external_ids/.test(url)) return { imdb_id: 'tt1375666' };
        if (/bestcine\.example\/stream\/movie/.test(url)) return { streams: [{ name: '4K', title: '🇧🇷 Dublado', url: 'https://bestcine.example/r/x' }] };
        throw new Error('nada');
    };
    const base = { buscarJson, sondar: async () => ({ viva: true, altura: 2160, dublado: true }), registrarFicha: () => { throw new Error('não deveria registrar'); } };
    const ja = await cacada.cacarTitulo({ tipo: 'movie', tmdbId: '27205', titulo: 'A Origem' }, { ...base, validar: async () => ({ aprovada: true }), fichasAtuais: () => [{ id: 'bestcine', ativo: true, urlMovie: 'https://bestcine.example/stream/movie/{imdb}.json' }] });
    assert.equal(ja.aprovadas.length, 0);
    const reprovada = await cacada.cacarTitulo({ tipo: 'movie', tmdbId: '27205', titulo: 'A Origem' }, { ...base, validar: async () => ({ aprovada: false, motivo: 'faltam duas provas' }), fichasAtuais: () => [] });
    assert.equal(reprovada.aprovadas.length, 0);
    assert.equal(reprovada.recusadas[0].motivo, 'faltam duas provas');
});

test('validação testa os espelhos do addon e ouve o áudio sem etiqueta', async () => {
    const ficha = { id: 'bestcine', nome: 'BestCine', urlTv: 'https://bestcine.example/stream/series/{imdb}:{temporada}:{episodio}.json', referer: 'https://bestcine.example/', passos: [{ tipo: 'json', caminho: 'streams[0].url' }], tipos: ['tv'] };
    const buscar = async url => JSON.stringify({ streams: [
        { name: '1080p', title: 'Athena 🇧🇷 Dublado', url: url.replace('/stream/', '/morto/').replace('.json', '.mp4') },
        { name: '1080p', title: 'Safira 🇧🇷 Dublado', url: url.replace('/stream/', '/vivo/').replace('.json', '.mp4') },
    ] });
    const sondar = async url => /morto/.test(url) ? { viva: false } : { viva: true, altura: 1080, dublado: null };
    const ouvidos = [];
    const r = await fichas.validar(ficha, [
        { tipo: 'tv', id: '1', imdb: 'tt0000001', temporada: 1, episodio: 5, titulo: 'Novela A' },
        { tipo: 'tv', id: '2', imdb: 'tt0000002', temporada: 1, episodio: 9, titulo: 'Novela B' },
    ], { buscar, sondar, confirmarIdioma: async pronto => { ouvidos.push(pronto.url); return true; } });
    assert.equal(r.aprovada, true, JSON.stringify(r.provas));
    assert.equal(r.ajustes.qualidade, '1080p');
    assert.equal(ouvidos.length, 2);
    assert.ok(ouvidos.every(u => /vivo/.test(u)));
});

test('publicação junta com o arquivo publicado: PC e Oracle não apagam as fichas um do outro', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'publica-'));
    try {
        fichas.gravar(pasta, { perfis: [{ id: 'bestcine', nome: 'BestCine', ativo: true }], listasTv: [], placar: [] });
        const publicado = { perfis: [{ id: 'fenixflix-fenixhub', ativo: true }, { id: 'bestcine', nome: 'antiga', ativo: false }], listasTv: [{ id: 'esportes' }], placar: [{ id: 'mgeb' }] };
        let enviado = null;
        const api = {
            get: async () => ({ data: { sha: 'abc', content: Buffer.from(JSON.stringify(publicado)).toString('base64') } }),
            put: async (url, corpo) => { enviado = JSON.parse(Buffer.from(corpo.content, 'base64').toString('utf8')); return {}; },
        };
        const r = await fichas.publicar(pasta, 'token', { api });
        assert.equal(r.ok, true);
        assert.deepEqual(enviado.perfis.map(p => p.id).sort(), ['bestcine', 'fenixflix-fenixhub']);
        assert.equal(enviado.perfis.find(p => p.id === 'bestcine').nome, 'BestCine', 'a ficha local mais nova vence');
        assert.deepEqual(enviado.listasTv, [{ id: 'esportes' }]);
        assert.deepEqual(enviado.placar, [{ id: 'mgeb' }]);
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('caçador do PC lê da Central só os títulos que falharam e não abriram depois', async () => {
    const axios = require('axios');
    const original = axios.get;
    const agora = new Date().toISOString();
    axios.get = async () => ({ status: 200, data: { sessoes: [
        { criadoEm: agora, id: '306956', titulo: 'Quem Ama Cuida · T1 E137', resultado: 'falhou', tentativas: [] },
        { criadoEm: agora, id: '306956', titulo: 'Quem Ama Cuida · T1 E136', resultado: 'abriu', tentativas: [{ fonteId: 'froststream' }] },
        { criadoEm: agora, id: '550', titulo: 'Clube da Luta', resultado: 'abriu', tentativas: [] },
        { criadoEm: agora, id: '550', titulo: 'Clube da Luta', resultado: 'falhou', tentativas: [] },
    ] } });
    try {
        const { titulosQueFalharam } = require('./cacador-pc.cjs');
        const lista = await titulosQueFalharam();
        assert.deepEqual(lista.map(t => t.chave), ['tv:306956:1:137']);
        assert.equal(lista[0].episodio, 137);
    } finally { axios.get = original; }
});
