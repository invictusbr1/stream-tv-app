'use strict';
// Fonte dublada de última instância: o extrator público do Kairou, que
// resolve o provedor VeTela. Foi ele que entregou o episódio 136 de
// "Quem Ama Cuida" (24/10/2026): MP4 1080p, áudio "por", 3077 s — o runtime
// do TMDB para o 136 é 51 min, então é o episódio certo.
//
// Por que existe: a FrostStream cobre 121–135, mas no 136 devolve o fallback
// MegaEmbed do episódio 1. O Kairou tem o VeTela para o 136; a API devolve o
// arquivo direto (server-utx.vodis01.com), sem página de anúncio no caminho.
//
// Limites: é uma API de agregador (depende do Kairou estar no ar), por isso
// entra como última opção dublada e com cache curto — o endereço do VeTela
// carrega um token de sessão. Só streams marcados como VeTela são aceitos;
// o fallback FrostStream/MegaEmbed que o Kairou também lista é ignorado.

const axios = require('axios');

const BASE = 'https://www.kairou.space';
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VALIDADE = 3 * 60 * 1000; // o token do VeTela é curto

const cache = new Map();
const cacheEpisodios = new Map();

function alturaDe(texto) {
    const s = String(texto || '');
    if (/\b(4k|uhd|2160)\b/i.test(s)) return 2160;
    const achado = /\b(1080|720|576|540|480|360)p?\b/i.exec(s);
    return achado ? Number(achado[1]) : 0;
}

// Recebe os streams da API do Kairou e fica só com o VeTela dublado.
// Função pura para os testes; a rede fica em resolverTodos.
function escolherStreams(streams, { tipo = 'tv' } = {}) {
    const lista = [];
    for (const bruto of Array.isArray(streams) ? streams : []) {
        if (!bruto) continue;
        if (bruto.isVeTela !== true) {
            // Os servidores 1080p dublados do Kairou não vêm marcados como
            // VeTela; aceita só os "Kairou · Servidor ..." dublados. Frost e
            // embeds continuam fora pelo filtro de URL abaixo.
            const kairouDublado = bruto.isDub === true && /^\s*Kairou\b/i.test(String(bruto.providerName || ''));
            if (!kairouDublado) continue;
        }
        if (bruto.isDub === false) continue;
        const url = String(bruto.url || '');
        if (!/^https:\/\//i.test(url)) continue;
        if (/megaembed|froststream|youtu\.?be/i.test(url)) continue;
        const hls = bruto.type === 'hls' || /\.m3u8(\?|$)|hls\.php/i.test(url);
        const qualidade = alturaDe(bruto.quality || bruto.providerName || url);
        lista.push({
            url,
            altura: qualidade,
            resolucao: qualidade ? qualidade + 'p' : '',
            type: hls ? 'hls' : 'file',
            nome: String(bruto.providerName || 'Kairou · VeTela'),
        });
    }
    return lista.sort((a, b) => b.altura - a.altura);
}

// A API do Kairou pode devolver o VeTela de outro capítulo. Em vez de
// aceitar só o mais recente (o que bloqueava séries antigas como Tulsa King),
// confere a data do arquivo do VeTela com a data do episódio no TMDB.
async function dadosEpisodio(id, temporada, episodio) {
    const chave = `${id}:${temporada}`;
    const salvo = cacheEpisodios.get(chave);
    let eps = salvo && salvo.expira > Date.now() ? salvo.valor : null;
    if (eps === null) {
        try {
            const r = await axios.get(`${TMDB}/tv/${id}/season/${temporada}`, {
                params: { api_key: TMDB_KEY },
                timeout: 8000,
                maxContentLength: 1024 * 1024,
                validateStatus: status => status === 200,
            });
            eps = r.data && Array.isArray(r.data.episodes) ? r.data.episodes : [];
            cacheEpisodios.set(chave, { valor: eps, expira: Date.now() + 10 * 60 * 1000 });
        } catch { return null; }
    }
    return eps.find(x => Number(x.episode_number) === Number(episodio)) || null;
}

async function resolverTodos(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return [];
    const serie = tipo === 'tv' || tipo === 'series';
    const s = Number(temporada) || 1;
    const e = Number(episodio) || 1;
    const chave = serie ? `tv:${id}:${s}:${e}` : `movie:${id}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now() && !opcoes.semCache) return guardado.valor;

    const params = { type: serie ? 'series' : 'movie' };
    if (serie) { params.season = String(s); params.episode = String(e); }
    params.tmdbId = id;
    let streams = [];
    try {
        const r = await axios.get(`${BASE}/api/extract`, {
            params,
            headers: { 'User-Agent': UA, Accept: 'application/json', Referer: BASE + '/' },
            timeout: 12000,
            maxContentLength: 2 * 1024 * 1024,
            validateStatus: status => status < 500,
        });
        streams = r.data && Array.isArray(r.data.streams) ? r.data.streams : [];
    } catch { return []; }

    const alvoEp = serie ? await dadosEpisodio(id, s, e) : null;
    const escolhidos = escolherStreams(streams, { tipo: serie ? 'tv' : 'movie' }).filter(item => {
        if (!serie || !alvoEp || !alvoEp.air_date) return true;
        const m = /Cap[ií]tulo de (\d{2})_(\d{2})_(\d{4})/i.exec(decodeURIComponent(item.url || ''));
        if (!m) return true;
        return `${m[3]}-${m[2]}-${m[1]}` === alvoEp.air_date;
    });
    if (!escolhidos.length) return [];
    const dados = escolhidos.map(item => ({
        url: item.url,
        audio: 'pt-BR',
        fonte: 'Kairou · VeTela',
        referer: BASE + '/',
        resolucao: item.resolucao,
        type: item.type,
        final: item.type === 'file',
    }));
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

async function resolver(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    return (await resolverTodos(tipo, tmdbId, temporada, episodio, opcoes))[0] || null;
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverTodos, resolverEpisodio, escolherStreams, BASE };
