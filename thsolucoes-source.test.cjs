const test = require('node:test');
const assert = require('node:assert/strict');
const th = require('./thsolucoes-source');

const CNVODS = { name: '#1 🇧🇷 [Dublado] CS', title: 'Opção 1 (MP4)', url: 'https://server-1.cnvods.com/m/Filme_2008_tt0468569.mp4?cnvs_token=x' };
const VODSHUBY = { name: '#2 🇧🇷 [Dublado] CS', title: 'Opção 2 (MP4)', url: 'https://play.vodshuby.com/movie/649970.mp4?token=x' };
const WASABI = { name: '#3 🇧🇷 [Dublado] SS', title: 'Opção 3 (MP4)', url: 'https://fiorent.s3.us-central-1.wasabisys.com/536955/155-V2.mp4' };
const LEGENDADO = { name: '#5 [Legendado] CS', title: 'Opção 5 (MP4)', url: 'https://server-1.cnvods.com/m/outro.mp4' };

test('aceita só servidores com dublado conferido, na ordem de preferência', () => {
    const lista = th.escolherStreams([VODSHUBY, WASABI, CNVODS]);
    assert.deepEqual(lista.map(x => x.url), [CNVODS.url, VODSHUBY.url]);
});

test('recusa legendado, http, lista HLS e repetidos', () => {
    const http = { ...CNVODS, url: 'http://server-1.cnvods.com/m/a.mp4' };
    const hls = { ...CNVODS, url: 'https://server-1.cnvods.com/m/a.m3u8' };
    assert.deepEqual(th.escolherStreams([LEGENDADO, http, hls]), []);
    assert.equal(th.escolherStreams([CNVODS, CNVODS]).length, 1);
});

test('resolver busca o IMDb e devolve o MP4 dublado direto', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    axios.get = async url => {
        if (String(url).includes('api.themoviedb.org')) return { data: { imdb_id: 'tt0468569' } };
        if (String(url) === 'https://addon.thsolucoes.site/stream/movie/tt0468569.json') return { data: { streams: [WASABI, CNVODS] } };
        throw new Error('URL inesperada: ' + url);
    };
    const dados = await th.resolver('movie', '155', null, null, { semCache: true });
    assert.equal(dados.url, CNVODS.url);
    assert.equal(dados.audio, 'pt-BR');
    assert.equal(dados.type, 'file');
    assert.equal(dados.final, true);
});

test('episódio pede o caminho de série do addon', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    const pedidos = [];
    axios.get = async url => {
        pedidos.push(String(url));
        if (String(url).includes('api.themoviedb.org')) return { data: { imdb_id: 'tt0944947' } };
        return { data: { streams: [{ ...CNVODS, url: 'https://server-utx.vodis01.com/act/GoT_S01E01.mp4?t=1' }] } };
    };
    const dados = await th.resolver('tv', '1399', '1', '1', { semCache: true });
    assert.ok(pedidos.includes('https://addon.thsolucoes.site/stream/series/tt0944947:1:1.json'));
    assert.match(dados.url, /vodis01\.com/);
});

test('sem stream conferido devolve vazio (o motor segue para a próxima)', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    axios.get = async url => String(url).includes('themoviedb') ? { data: { imdb_id: 'tt1234567' } } : { data: { streams: [WASABI] } };
    assert.equal(await th.resolver('movie', '999', null, null, { semCache: true }), null);
});
