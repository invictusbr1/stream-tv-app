const test = require('node:test');
const assert = require('node:assert/strict');
const kairou = require('./kairou-source');

const VETELA = {
    providerName: 'Kairou · Servidor Principal (1080p Full HD) [Dublado]',
    quality: '1080p Full HD',
    type: 'mp4',
    isDub: true,
    isVeTela: true,
    url: 'https://server-utx.vodis01.com/m/Quem Ama Cuida _ Capítulo de 24_10_2026 _ Globoplay.mp4?cnvs_token=abc',
};
const FROST_FALLBACK = {
    providerName: 'Kairou · Servidor Ultra (720p HD) [Dublado]',
    quality: '720p HD',
    type: 'mp4',
    isDub: true,
    url: 'https://froststream.cloutteam.com/series/v1.ep1-fallback',
};

test('só o VeTela dublado entra; o fallback FrostStream é ignorado', () => {
    const lista = kairou.escolherStreams([FROST_FALLBACK, VETELA], { tipo: 'tv' });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].url, VETELA.url);
    assert.equal(lista[0].resolucao, '1080p');
    assert.equal(lista[0].type, 'file');
});

test('sem VeTela não sobra nada (melhor não tocar do que tocar o episódio 1)', () => {
    assert.deepEqual(kairou.escolherStreams([FROST_FALLBACK], { tipo: 'tv' }), []);
    assert.deepEqual(kairou.escolherStreams([], { tipo: 'tv' }), []);
});

test('VeTela marcado como legendado não entra como dublado', () => {
    assert.deepEqual(kairou.escolherStreams([{ ...VETELA, isDub: false }], { tipo: 'tv' }), []);
});

test('resolver chama a API do Kairou com o episódio certo e devolve o VeTela', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    let pedido = null;
    axios.get = async (url, opcoes) => {
        if (String(url).includes('api.themoviedb.org')) return { data: { episodes: [
            { episode_number: 121, air_date: '2026-10-06' },
            { episode_number: 135, air_date: '2026-10-22' },
            { episode_number: 136, air_date: '2026-10-24' }
        ] } };
        pedido = { url: String(url), params: opcoes && opcoes.params };
        return { data: { ok: true, streams: [VETELA, FROST_FALLBACK] } };
    };
    const dados = await kairou.resolver('tv', '306956', '1', '136', { semCache: true });
    assert.equal(pedido.url, kairou.BASE + '/api/extract');
    assert.equal(pedido.params.type, 'series');
    assert.equal(pedido.params.season, '1');
    assert.equal(pedido.params.episode, '136');
    assert.equal(pedido.params.tmdbId, '306956');
    assert.equal(dados.url, VETELA.url);
    assert.equal(dados.audio, 'pt-BR');
    assert.equal(dados.resolucao, '1080p');
    assert.equal(dados.type, 'file');
    assert.equal(dados.final, true);
});
test('não aceita o VeTela do capítulo mais recente quando o pedido é outro episódio', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    axios.get = async url => String(url).includes('api.themoviedb.org')
        ? { data: { episodes: [{ episode_number: 121, air_date: '2026-10-06' }, { episode_number: 136, air_date: '2026-10-24' }] } }
        : { data: { ok: true, streams: [VETELA] } };
    assert.equal(await kairou.resolver('tv', '306956', '1', '121', { semCache: true }), null);
});

test('episódio sem VeTela devolve vazio para o motor seguir', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    axios.get = async url => String(url).includes('api.themoviedb.org')
        ? { data: { episodes: [{ episode_number: 121, air_date: '2026-10-06' }, { episode_number: 136, air_date: '2026-10-24' }] } }
        : { data: { ok: true, streams: [FROST_FALLBACK] } };
    assert.equal(await kairou.resolver('tv', '910040', '1', '137', { semCache: true }), null);
});
