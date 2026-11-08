'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-'));
const ac = require('./anime-catalogo');

test('estação do anime (temporada do Japão) a partir da data', () => {
    assert.deepStrictEqual(ac.estacaoAtual(new Date('2026-11-07T12:00:00Z')), { season: 'FALL', ano: 2026, nome: 'Outono 2026' });
    assert.strictEqual(ac.estacaoAtual(new Date('2027-02-01T00:00:00Z')).season, 'WINTER');
    assert.strictEqual(ac.estacaoAtual(new Date('2026-07-15T00:00:00Z')).nome, 'Verão 2026');
});

test('nomes para achar no TMDB: tira "temporada"/"parte" e o subtítulo depois dos dois pontos', () => {
    const n = ac.nomesParaBusca({ title: { english: 'Jujutsu Kaisen Season 2', romaji: 'Jujutsu Kaisen 2nd Season' } });
    assert.ok(n.includes('Jujutsu Kaisen'));
    const f = ac.nomesParaBusca({ title: { english: "Frieren: Beyond Journey's End", romaji: 'Sousou no Frieren' } });
    assert.ok(f.includes('Frieren') && f.includes('Sousou no Frieren'));
    const r = ac.nomesParaBusca({ title: { english: 'Re:ZERO -Starting Life in Another World- Season 3', romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu 3rd Season' } });
    assert.ok(!r.includes('Re'), 'não reduz Re:ZERO para "Re"');
});

test('clima do "Me surpreenda" e cartão no formato do app', () => {
    assert.deepStrictEqual(ac.climas({ genres: ['Comedy', 'Romance'], episodes: 12 }), ['leve', 'romance', 'curto']);
    const c = ac.cartaoDoTmdb({ id: 209867, name: 'Frieren', poster_path: '/p.jpg', backdrop_path: '/b.jpg', first_air_date: '2023-09-29', vote_average: 8.86, overview: 'x' }, 'tv');
    assert.deepStrictEqual([c.id, c.tipo, c.anime, c.ano, c.nota], ['209867', 'tv', true, '2023', 8.9]);
    assert.match(c.capa, /^https:\/\/image\.tmdb\.org\/t\/p\/w342\/p\.jpg$/);
});

test('dublados: com a TorBox confirmando, ganha selo e entra a fileira "Dublados em português" antes dos mais amados', () => {
    const mem = ac._memoria();
    mem.dublado['tv:1'] = { em: Date.now(), sim: true };
    const p = { destaque: { id: '1', tipo: 'tv' }, calendario: {}, sorteio: [], fileiras: [
        { id: 'emAlta', titulo: 'x', itens: [{ id: '1', tipo: 'tv' }, { id: '2', tipo: 'tv' }] },
        { id: 'amados', titulo: 'y', itens: [{ id: '1', tipo: 'tv' }] },
    ] };
    const r = ac.aplicarDublados(p);
    assert.deepStrictEqual(r.fileiras.map(f => f.id), ['emAlta', 'dublados', 'amados']);
    assert.strictEqual(r.fileiras[1].itens.length, 1);
    assert.strictEqual(r.destaque.dublado, true);
    assert.strictEqual(r.fileiras[0].itens[1].dublado, undefined);
});
