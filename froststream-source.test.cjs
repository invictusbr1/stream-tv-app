const test = require('node:test');
const assert = require('node:assert/strict');
const frost = require('./froststream-source');

const REAL = {
    url: 'https://froststream.cloutteam.com/series/v1.real-121',
    name: 'FrostStream 1080p',
    title: '🎬 Quem Ama Cuida 2026 (2026)\n🥏 T01·E121\n🌊 Carbon\n🌎 Português',
    behaviorHints: { bingeGroup: 'cloutstream-cs:series:quem-ama-cuida-2026-2026' },
};
const FALLBACK = {
    url: 'https://froststream.cloutteam.com/series/v1.fallback-ep1',
    name: 'FrostStream 720p',
    title: '🎬 Quem Ama Cuida\n🥏 T01·E136\n🍃 MegaEmbed\n🌎 Português',
    headers: {
        Origin: 'https://megaembed.com/embed/306956/1/136',
        Referer: 'https://megaembed.com/embed/306956/1/136',
    },
    behaviorHints: { bingeGroup: 'megaembed-serie-306956' },
};

test('o título da FrostStream declara temporada e episódio', () => {
    assert.deepEqual(frost.episodioDoTitulo('🥏 T01·E121'), { temporada: 1, episodio: 121 });
    assert.deepEqual(frost.episodioDoTitulo('T01 EP136'), { temporada: 1, episodio: 136 });
    assert.equal(frost.episodioDoTitulo('sem marcação'), null);
});

test('escolhe o MP4 do episódio certo e ignora o MegaEmbed', () => {
    const lista = frost.escolherStreams([REAL, FALLBACK], { tipo: 'tv', temporada: 1, episodio: 121 });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].url, REAL.url);
    assert.equal(lista[0].resolucao, '1080p');
});

test('não aceita o fallback do episódio 1 rotulado como 136', () => {
    assert.deepEqual(frost.escolherStreams([FALLBACK], { tipo: 'tv', temporada: 1, episodio: 136 }), []);
});

test('não aceita título de outro episódio', () => {
    const outro = { ...REAL, title: '🎬 Quem Ama Cuida\n🥏 T01·E120\n🌊 Carbon\n🌎 Português' };
    assert.deepEqual(frost.escolherStreams([outro], { tipo: 'tv', temporada: 1, episodio: 121 }), []);
});

test('filme não tem marcador T/E e continua aceito', () => {
    const filme = { url: 'https://froststream.cloutteam.com/series/v1.filme', name: 'FrostStream 1080p', title: '🎬 Um Filme\n🌎 Português' };
    const lista = frost.escolherStreams([filme], { tipo: 'movie' });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].resolucao, '1080p');
});

test('resolver busca o IMDb e devolve o MP4 dublado do episódio', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    axios.get = async (url, opcoes) => {
        if (String(url).includes('api.themoviedb.org')) return { data: { imdb_id: 'tt42751057' } };
        if (String(url).includes('froststream.cloutteam.com/stream/series/tt42751057:1:121.json')) {
            return { data: { streams: [REAL, FALLBACK] } };
        }
        if (url === REAL.url) return { status: 200, headers: { 'content-type': 'video/mp4' }, data: Buffer.alloc(0) };
        throw new Error('URL inesperada: ' + url);
    };
    const dados = await frost.resolver('tv', '910030', '1', '121', { semCache: true });
    assert.equal(dados.url, REAL.url);
    assert.equal(dados.audio, 'pt-BR');
    assert.equal(dados.resolucao, '1080p');
    assert.equal(dados.type, 'file');
    assert.equal(dados.final, true);
});


test('episódio sem fonte real devolve vazio (o motor segue para a próxima)', async t => {
    const axios = require('axios');
    const original = axios.get;
    t.after(() => { axios.get = original; });
    axios.get = async url => {
        if (String(url).includes('api.themoviedb.org')) return { data: { imdb_id: 'tt42751057' } };
        return { data: { streams: [FALLBACK] } };
    };
    assert.equal(await frost.resolver('tv', '910031', '1', '136', { semCache: true }), null);
});
