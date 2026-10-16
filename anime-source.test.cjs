'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarResolvedor, validarAnime, validarBlogger, episodioFornecedor } = require('./anime-source');

const KEY = 'tmdb-chave-de-teste';
const BLOGGER = 'https://www.blogger.com/video.g?token=publico_para_teste_1234567890';
const alvo = { tmdbId: 37854, temporada: 1, episodio: 1, tmdbKey: KEY };
const anime = { id: 37854, genres: [{ id: 16 }], origin_country: ['JP'], original_language: 'ja' };
function season(numero, episodios) {
    return { season_number: numero, episodes: episodios.map(e => ({ season_number: numero, episode_number: e })) };
}
function montar(opcoes = {}) {
    const chamadas = [];
    const get = async (url, opts) => {
        chamadas.push({ url, opts });
        if (opcoes.get) return opcoes.get(url, opts, chamadas.length);
        if (url.endsWith('/season/1')) return { status: 200, data: opcoes.temporada || season(1, [1, 2]) };
        if (url.endsWith('/tv/37854')) return { status: 200, data: opcoes.anime || anime };
        if (url === 'https://serv01.meusdoramas.club/posts/get-video.php') {
            return { status: 200, data: opcoes.video || { success: true, videoUrl: BLOGGER } };
        }
        throw new Error('Pedido inesperado no teste');
    };
    return { ...criarResolvedor({ get, agora: opcoes.agora }), chamadas };
}

test('anime exige animação e origem japonesa/coreana ou idioma japonês', () => {
    assert.equal(validarAnime(anime, 37854), true);
    assert.equal(validarAnime({ ...anime, origin_country: ['KR'], original_language: 'ko' }, 37854), true);
    assert.equal(validarAnime({ ...anime, genres: [{ id: 18 }] }, 37854), false);
    assert.equal(validarAnime({ ...anime, origin_country: ['US'], original_language: 'en' }, 37854), false);
    assert.equal(validarAnime({ ...anime, id: 999 }, 37854), false);
});

test('Blogger aceita somente player HTTPS público sem credenciais, desvios ou URL de mídia', () => {
    assert.equal(validarBlogger(BLOGGER), BLOGGER);
    for (const url of [
        'http://www.blogger.com/video.g?token=publico_para_teste_1234567890',
        'https://www.blogger.com.evil.test/video.g?token=publico_para_teste_1234567890',
        'https://usuario:senha@www.blogger.com/video.g?token=publico_para_teste_1234567890',
        'https://www.blogger.com:8443/video.g?token=publico_para_teste_1234567890',
        'https://www.blogger.com/redirect?token=publico_para_teste_1234567890',
        BLOGGER + '&token=outro_token_publico_1234567890',
        BLOGGER + '&redirect=https://evil.test/', BLOGGER + '#/outro',
        'https://www.blogger.com/video.g?token=curto',
        'https://rr1.googlevideo.com/videoplayback?id=temporario',
        'javascript:alert(1)', 'http://127.0.0.1/video.g', null
    ]) assert.equal(validarBlogger(url), null);
});

test('primeiro episódio resolve como embed e mantém a identidade do pedido', async () => {
    const r = montar();
    const resultado = await r.resolverEpisodio(alvo);
    assert.equal(resultado.url, BLOGGER);
    assert.equal(resultado.tipo, 'embed');
    assert.equal(resultado.fonteId, 'meus-animes');
    assert.equal(resultado.anime, true);
    assert.equal(resultado.audio, 'original');
    assert.equal(resultado.legendaPortugues, true);
    assert.equal(resultado.legendaEmbutida, true);
    assert.equal(resultado.pagina, 'https://meusanimes.blog/e/one-piece-1-episodio-1/');
    assert.deepEqual(resultado.episode, { season: 1, number: 1 });
    assert.deepEqual(r.chamadas.at(-1).opts.params, { episode_number: 1, season_number: 1, tmdb: 37854 });
    assert.equal('resolucao' in resultado, false);
    assert.equal(JSON.stringify(resultado).includes(KEY), false);
});

test('séries, IDs não conferidos e escolha dublada não acionam o fornecedor', async () => {
    const r = montar();
    for (const ajuste of [
        { tmdbId: 1399 }, { tmdbId: '37854/../1' }, { temporada: 0 }, { episodio: 0 },
        { episodio: -1 }, { episodio: '1&episode_number=2' }, { tmdbKey: '' },
        { audio: 'dublado' }, { audio: 'pt-BR' }, { audio: 'qualquer' }
    ]) assert.equal(await r.resolverEpisodio({ ...alvo, ...ajuste }), null);
    assert.equal(r.chamadas.length, 0);
    assert.equal(await r.resolverEpisodio(), null);
});

test('metadados diferentes ou fora de anime recusam antes da API de reprodução', async () => {
    for (const metadados of [
        { ...anime, id: 12 }, { ...anime, genres: [{ id: 18 }] },
        { ...anime, origin_country: ['US'], original_language: 'en' }
    ]) {
        const r = montar({ anime: metadados });
        assert.equal(await r.resolverEpisodio(alvo), null);
        assert.equal(r.chamadas.length, 1);
    }
});

test('One Piece usa o número absoluto confirmado; não soma temporadas nem abre episódio errado', () => {
    assert.deepEqual(episodioFornecedor(37854, 23, 1180, season(23, [1156, 1180])), { temporada: 1, episodio: 1180 });
    assert.equal(episodioFornecedor(37854, 23, 1, season(23, [1156, 1180])), null);
    assert.equal(episodioFornecedor(37854, 23, 1180, season(22, [1180])), null);
    assert.equal(episodioFornecedor(37854, 23, 1, season(23, [1])), null);
    assert.equal(episodioFornecedor(37854, 1, 100, season(1, [1, 2])), null);
});

test('Solo Leveling mapeia os 25 episódios TMDB para as temporadas 12+13 do fornecedor', () => {
    const dados = season(1, [1, 12, 13, 25]);
    assert.deepEqual(episodioFornecedor(127532, 1, 12, dados), { temporada: 1, episodio: 12 });
    assert.deepEqual(episodioFornecedor(127532, 1, 13, dados), { temporada: 2, episodio: 1 });
    assert.deepEqual(episodioFornecedor(127532, 1, 25, dados), { temporada: 2, episodio: 13 });
    assert.equal(episodioFornecedor(127532, 2, 1, season(2, [1])), null);
    assert.equal(episodioFornecedor(127532, 1, 26, season(1, [26])), null);
});

test('API recebe a ponte Solo Leveling e o resultado conserva temporada e episódio do aplicativo', async () => {
    const r = montar({ get: async (url, opts) => {
        if (url.endsWith('/tv/127532')) return { status: 200, data: { ...anime, id: 127532 } };
        if (url.endsWith('/season/1')) return { status: 200, data: season(1, [13]) };
        assert.deepEqual(opts.params, { episode_number: 1, season_number: 2, tmdb: 127532 });
        return { status: 200, data: { success: true, videoUrl: BLOGGER } };
    } });
    const resultado = await r.resolverEpisodio({ ...alvo, tmdbId: 127532, episodio: 13 });
    assert.deepEqual(resultado.episode, { season: 1, number: 13 });
    assert.deepEqual(resultado.providerEpisode, { season: 2, number: 1 });
    assert.equal(resultado.pagina, 'https://meusanimes.blog/e/solo-leveling-2-episodio-1/');
});

test('episódio inexistente, resposta negativa ou player fora da lista retornam indisponível', async () => {
    const semEpisodio = montar({ temporada: season(1, [2]) });
    assert.equal(await semEpisodio.resolverEpisodio(alvo), null);
    assert.equal(semEpisodio.chamadas.length, 2);
    for (const video of [
        { success: false, videoUrl: BLOGGER }, { success: 'true', videoUrl: BLOGGER },
        { success: true, videoUrl: 'https://rr1.googlevideo.com/videoplayback' },
        { success: true }, [], 'não é JSON'
    ]) assert.equal(await montar({ video }).resolverEpisodio(alvo), null);
});

test('cache curto renova o endereço público e não mistura episódios', async () => {
    let tempo = 1000;
    const r = montar({ agora: () => tempo });
    await r.resolverEpisodio(alvo);
    await r.resolverEpisodio(alvo);
    assert.equal(r.chamadas.length, 3);
    await r.resolverEpisodio({ ...alvo, episodio: 2 });
    assert.equal(r.chamadas.length, 4);
    assert.equal(r.chamadas.at(-1).opts.params.episode_number, 2);
    tempo += 2 * 60 * 1000 + 1;
    await r.resolverEpisodio(alvo);
    assert.equal(r.chamadas.length, 5);
    assert.equal(r.chamadas.at(-1).opts.params.episode_number, 1);
    tempo += 10 * 60 * 1000;
    await r.resolverEpisodio(alvo);
    assert.equal(r.chamadas.length, 8);
});

test('HTTP tem prazo global, tamanho limitado e não segue redirecionamento externo', async () => {
    let tempo = 1000;
    const r = montar({ agora: () => tempo, get: async (url, opts, n) => {
        assert.equal(opts.maxRedirects, 0);
        assert.equal(opts.validateStatus(200), true);
        assert.equal(opts.validateStatus(302), false);
        assert.equal(opts.validateStatus(403), false);
        assert.equal(opts.responseType, 'json');
        assert.ok(opts.maxContentLength <= 1024 * 1024);
        assert.equal(opts.timeout, [20000, 15000, 10000][n - 1]);
        assert.ok(opts.signal instanceof AbortSignal);
        tempo += 5000;
        return { status: 200, data: n === 1 ? anime : n === 2 ? season(1, [1]) : { success: true, videoUrl: BLOGGER } };
    } });
    assert.equal((await r.resolverEpisodio(alvo)).url, BLOGGER);
});

test('resposta fora do prazo, erro de rede e JSON inválido são falhas neutras', async () => {
    const foraDoPrazo = montar({ agora: () => tempo, get: async () => {
        tempo += 20001;
        return { status: 200, data: anime };
    } });
    let tempo = 1000;
    assert.equal(await foraDoPrazo.resolverEpisodio(alvo), null);
    for (const get of [
        async () => { throw new Error('Conexão falhou'); },
        async () => ({ status: 403, data: anime }),
        async () => ({ status: 200, data: 'JSON quebrado' }),
        async () => ({ status: 200, data: 'x'.repeat(1024 * 1024 + 1) })
    ]) assert.equal(await montar({ get }).resolverEpisodio(alvo), null);
});

test('cancelar antes ou durante a consulta não deixa reprodução tardia nem devolve cache', async () => {
    const controller = new AbortController();
    const r = montar();
    await r.resolverEpisodio(alvo);
    controller.abort();
    assert.equal(await r.resolverEpisodio({ ...alvo, signal: controller.signal }), null);
    assert.equal(r.chamadas.length, 3);

    const durante = new AbortController();
    let iniciou;
    const pronto = new Promise(resolve => { iniciou = resolve; });
    const cancelado = montar({ get: async (url, opts) => {
        iniciou();
        return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('Abortado')), { once: true }));
    } });
    const pedido = cancelado.resolverEpisodio({ ...alvo, signal: durante.signal });
    await pronto;
    durante.abort();
    assert.equal(await pedido, null);
    assert.equal(cancelado.chamadas.length, 1);
});

test('resposta JSON textual legítima é aceita sem expor chave TMDB ao resultado', async () => {
    const r = montar({ get: async (url, opts, n) => ({ status: 200, data: JSON.stringify(n === 1 ? anime : n === 2 ? season(1, [1]) : { success: true, videoUrl: BLOGGER }) }) });
    const resultado = await r.resolverEpisodio(alvo);
    assert.equal(resultado.url, BLOGGER);
    assert.equal(JSON.stringify(resultado).includes(KEY), false);
});
