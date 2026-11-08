'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const d = require('./descoberta');
const perfis = require('./perfis');

const h = n => String(n).repeat(40).slice(0, 40);
const st = (hash, titulo) => ({ infoHash: h(hash), title: titulo });
function torbox(prontos, extra = {}) {
    return {
        emCache: async hashes => new Set(hashes.filter(x => prontos.includes(x))),
        ehPortugues: t => /dublad|pt-?br/i.test(t), rotuloDe: s => s.title, hashDe: s => s.infoHash,
        listas: () => ['https://fixa.net'], listasAnime: () => ['https://anime-fixa.net'],
        qualidade: t => /1080p/.test(t) ? '1080p' : /720p/.test(t) ? '720p' : '480p', ...extra,
    };
}

test('anime: aprova lista com episódio novo pronto em 2+ testes e separa legendado/dublado', async () => {
    const buscarJson = async url => {
        if (url.startsWith('https://nova.net')) {
            if (/tt22248376/.test(url)) return { streams: [st(1, '[Erai-raws] Frieren 05 1080p MultiSub'), st(2, 'Frieren 05 720p Dublado')] };
            if (/tt30217403/.test(url)) return { streams: [st(3, 'Dandadan 02 1080p'), st(9, 'Dandadan 02 480p')] };
            return { streams: [] };
        }
        // As listas atuais já têm o hash 3.
        return { streams: /tt30217403/.test(url) ? [st(4, 'x 1080p')] : [] };
    };
    const r = await d.avaliarParaAnime({ base: 'https://nova.net' }, { buscarJson, torbox: torbox([h(1), h(2), h(3)]) });
    assert.equal(r.aprovar, true);
    assert.equal(r.titulosComNovos, 2);
    assert.equal(r.legendado, 2);
    assert.equal(r.dublado, 1);
});

test('anime: recusa quando só repete o que as listas atuais já têm', async () => {
    const buscarJson = async url => ({ streams: [st(5, 'Frieren 1080p')] });
    const r = await d.avaliarParaAnime({ base: 'https://repetida.net' }, { buscarJson, torbox: torbox([h(5)]) });
    assert.equal(r.aprovar, false);
});

test('caçada de anime: mede sementes, grava aprovadas em listasAnime e não repete na semana', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-'));
    const memoria = d.criarMemoria(pasta);
    const aprovadasAnime = [], aprovadasGeral = [];
    const buscarJson = async url => url.startsWith('https://torrentio.strem.fun/providers=nyaasi')
        ? { streams: [st(/tt22248376/.test(url) ? 6 : /tt30217403/.test(url) ? 7 : 8, 'Ep 1080p Dublado PT-BR')] }
        : { streams: [] };
    const tb = torbox([h(6), h(7)], { aprovarAnime: r => aprovadasAnime.push(r), aprovar: r => aprovadasGeral.push(r) });
    const res = await d.cacarAnime(memoria, { buscarJson, torbox: tb }, { quantos: 10, agora: 1000 });
    assert.ok(res.length >= d.SEMENTES_ANIME.length);
    assert.equal(aprovadasAnime.length, 1);
    assert.match(aprovadasAnime[0].base, /providers=nyaasi/);
    assert.equal(aprovadasGeral.length, 1, 'anime dublado novo também entra no motor 1');
    const de2 = await d.cacarAnime(memoria, { buscarJson, torbox: tb }, { quantos: 10, agora: 2000 });
    assert.equal(de2.length, 0);
});

test('listasAnime: aprova, publica junto e recusa endereço inseguro', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'perfis-anime-'));
    perfis.aprovarListaAnime(pasta, { base: 'https://anime.net/', nome: 'Anime', legendado: 3, dublado: 1 });
    assert.equal(perfis.aprovarListaAnime(pasta, { base: 'http://x.net' }), null);
    const local = perfis.ler(pasta);
    assert.deepEqual(local.listasAnime.map(l => [l.base, l.legendado]), [['https://anime.net', 3]]);
    const juntos = perfis.juntarPublicado({ listasAnime: [{ base: 'https://velha.net' }] }, local);
    assert.deepEqual(juntos.listasAnime.map(l => l.base).sort(), ['https://anime.net', 'https://velha.net']);
});
