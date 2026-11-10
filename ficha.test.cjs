'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registrar = require('./rotas/ficha');

function app() {
    const rotas = {};
    const add = m => (p, h) => {
        if (Array.isArray(p)) p.forEach(c => { rotas[m + ' ' + c] = h; });
        else rotas[m + ' ' + p] = h;
    };
    return { rotas, get: add('GET'), post: add('POST'), delete: add('DELETE') };
}
function chamar(a, chave, req) {
    return new Promise(resolve => {
        const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ code: this.code, d }); } };
        Promise.resolve(a.rotas[chave](req, res));
    });
}

test('ficha monta informações, elenco, trailer e crítica do TMDB', async () => {
    const original = global.fetch;
    global.fetch = async url => ({ ok: true, json: async () => /\/reviews\?/.test(url) ? { results: [] } : {
        runtime: 125, release_date: '2023-07-20', original_language: 'en', original_title: 'Oppenheimer', tagline: 'O mundo muda para sempre.',
        vote_average: 8.12, vote_count: 9000, production_companies: [{ name: 'Syncopy' }],
        credits: { cast: [{ name: 'Cillian Murphy', character: 'J. Robert Oppenheimer', profile_path: '/a.jpg' }], crew: [{ job: 'Director', name: 'Christopher Nolan' }] },
        release_dates: { results: [{ iso_3166_1: 'BR', release_dates: [{ certification: '16' }] }] },
        videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abcdefgh123', iso_639_1: 'pt' }] },
        reviews: { results: [{ id: 'r1', author: 'Ana', content: 'Um filme incrível, atuação impecável.', author_details: { rating: 9 } }] },
    } });
    try {
        const a = app(); registrar(a, { DADOS_DIR: os.tmpdir(), TMDB_KEY: 'x' });
        const r = await chamar(a, 'GET /api/ficha/:tipo/:id', { params: { tipo: 'movie', id: '872585' } });
        assert.equal(r.code, 200);
        assert.equal(r.d.duracao, 125);
        assert.equal(r.d.classificacao, '16');
        assert.deepEqual(r.d.direcao, ['Christopher Nolan']);
        assert.equal(r.d.elenco[0].nome, 'Cillian Murphy');
        assert.equal(r.d.trailer, 'abcdefgh123');
        assert.equal(r.d.nota, 8.1);
        assert.equal(r.d.criticas[0].ingles, false);
        const ruim = await chamar(a, 'GET /api/ficha/:tipo/:id', { params: { tipo: 'x', id: '1' } });
        assert.equal(ruim.code, 400);
    } finally { global.fetch = original; }
});

test('comentários da família: um por aparelho, marca o próprio e apaga', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coment-'));
    const a = app(); registrar(a, { DADOS_DIR: dir, TMDB_KEY: 'x' });
    const marlon = { dispositivoAutorizado: { dispositivo: 'pc-1', nome: 'Marlon' } };
    const larissa = { dispositivoAutorizado: { dispositivo: 'cel-2', nome: 'Larissa' } };
    const p = { tipo: 'movie', id: '10' };
    await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...marlon, params: p, body: { nota: 5, texto: 'Muito bom' } });
    await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...marlon, params: p, body: { nota: 4, texto: 'Bom\n demais' } });
    await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...larissa, params: p, body: { nota: 3 } });
    const vazio = await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...larissa, params: p, body: { nota: 0, texto: ' ' } });
    assert.equal(vazio.code, 400);
    const lista = (await chamar(a, 'GET /api/comentarios/:tipo/:id', { ...marlon, params: p })).d;
    assert.equal(lista.length, 2);
    const meu = lista.find(c => c.meu);
    assert.equal(meu.nome, 'Marlon'); assert.equal(meu.nota, 4); assert.equal(meu.texto, 'Bom demais');
    assert.ok(!('chave' in meu));
    assert.ok(fs.existsSync(path.join(dir, 'comentarios.json')));
    const depois = (await chamar(a, 'DELETE /api/comentarios/:tipo/:id', { ...marlon, params: p })).d;
    assert.deepEqual(depois.map(c => c.nome), ['Larissa']);
});

test('Android: comenta por GET com o id do aparelho e acha o nome no cadastro', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coment-'));
    const seguranca = { autorizados: () => ({ t1: { nome: 'Larissa', dispositivo: 'dabc12345' } }) };
    const a = app(); registrar(a, { DADOS_DIR: dir, TMDB_KEY: 'x', seguranca });
    const p = { tipo: 'tv', id: '1399' };
    const r = await chamar(a, 'GET /api/comentarios/:tipo/:id/enviar', { params: p, query: { disp: 'dabc12345', nota: '5', texto: 'Amei' }, ip: '1.1.1.1' });
    assert.equal(r.d[0].nome, 'Larissa'); assert.equal(r.d[0].meu, true); assert.equal(r.d[0].nota, 5);
    const outro = (await chamar(a, 'GET /api/comentarios/:tipo/:id', { params: p, query: { disp: 'dzzz99999' }, ip: '1.1.1.1' })).d;
    assert.equal(outro[0].meu, false);
    const apagado = (await chamar(a, 'GET /api/comentarios/:tipo/:id/apagar', { params: p, query: { disp: 'dabc12345' } })).d;
    assert.equal(apagado.length, 0);
});

test('indicações da família: calcula média das notas, ordena e traz metadados', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coment-ind-'));
    const a = app(); registrar(a, { DADOS_DIR: dir, TMDB_KEY: 'x' });
    
    // Sem comentários: retorna vazio
    const vazio = (await chamar(a, 'GET /api/indicacoes-familia', {})).d;
    assert.deepEqual(vazio, { itens: [], total: 0 });

    const marlon = { dispositivoAutorizado: { dispositivo: 'pc-1', nome: 'Marlon' } };
    const larissa = { dispositivoAutorizado: { dispositivo: 'cel-2', nome: 'Larissa' } };

    // Simula mock do fetch para o TMDB
    const originalFetch = global.fetch;
    global.fetch = async url => ({
        ok: true,
        json: async () => {
            if (url.includes('/movie/100')) {
                return { title: 'Interestelar', overview: 'Exploração espacial.', release_date: '2014-11-06', poster_path: '/poster1.jpg', vote_average: 8.6 };
            }
            if (url.includes('/tv/200')) {
                return { name: 'Breaking Bad', overview: 'Química e crime.', first_air_date: '2008-01-20', poster_path: '/poster2.jpg', vote_average: 8.9 };
            }
            return null;
        }
    });

    try {
        // Título 1: Interestelar (Larissa nota 5, Marlon nota 5 -> média 5.0)
        await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...larissa, params: { tipo: 'movie', id: '100' }, body: { nota: 5, texto: 'Perfeito!' } });
        await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...marlon, params: { tipo: 'movie', id: '100' }, body: { nota: 5, texto: 'Obra prima' } });

        // Título 2: Breaking Bad (Marlon nota 4 -> média 4.0)
        await chamar(a, 'POST /api/comentarios/:tipo/:id', { ...marlon, params: { tipo: 'tv', id: '200' }, body: { nota: 4, texto: 'Muito bom' } });

        const r = (await chamar(a, 'GET /api/indicacoes-familia', {})).d;
        assert.equal(r.total, 2);
        assert.equal(r.itens.length, 2);

        // Maior nota primeiro: Interestelar (5.0) antes de Breaking Bad (4.0)
        assert.equal(r.itens[0].titulo, 'Interestelar');
        assert.equal(r.itens[0].tipo, 'movie');
        assert.equal(r.itens[0].id, 100);
        assert.equal(r.itens[0].notaFamilia, 5.0);
        assert.equal(r.itens[0].votosFamilia, 2);
        assert.deepEqual(r.itens[0].autoresFamilia.sort(), ['Larissa', 'Marlon']);

        assert.equal(r.itens[1].titulo, 'Breaking Bad');
        assert.equal(r.itens[1].tipo, 'tv');
        assert.equal(r.itens[1].id, 200);
        assert.equal(r.itens[1].notaFamilia, 4.0);
        assert.equal(r.itens[1].votosFamilia, 1);

        const alias = (await chamar(a, 'GET /api/comentarios/indicacoes', {})).d;
        assert.equal(alias.total, 2);
    } finally {
        global.fetch = originalFetch;
    }
});
