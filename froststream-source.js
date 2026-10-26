'use strict';
// Fonte dublada do addon público FrostStream (a mesma que o Kairou usa).
//
// Medido em 25/10/2026 em "Quem Ama Cuida" 1x121: MP4 progressivo 1920x1080,
// áudio AAC "por" (português), 3167 s, servido direto por
// froststream.cloutteam.com — sem página e sem playlist de anúncio.
//
// Limite conhecido: quando o episódio não existe no catálogo, o addon devolve
// o MegaEmbed do episódio 1 (HLS 720p, 3590 s) com o título do episódio
// pedido. Esse fallback é recusado por três sinais: "MegaEmbed" no
// título/bingeGroup, headers Origin/Referer de megaembed.com e endereço de
// lista (.m3u8). Só arquivo MP4 do próprio FrostStream é aceito.

const axios = require('axios');

const BASE = 'https://froststream.cloutteam.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const VALIDADE = 20 * 60 * 1000;

const cache = new Map();
const cacheImdb = new Map();

function numero(valor) { const n = Number(valor); return Number.isFinite(n) && n > 0 ? n : 0; }

// "Quem Ama Cuida 2026 (2026) / T01·E121 / Carbon / Português"
function episodioDoTitulo(texto) {
    const achado = /\bT(\d{1,2})\s*[·.\-: ]?\s*E?P?(\d{1,3})\b/i.exec(String(texto || ''));
    return achado ? { temporada: Number(achado[1]), episodio: Number(achado[2]) } : null;
}

function alturaDoTexto(texto) {
    const s = String(texto || '');
    if (/\b(4k|uhd|2160p?)\b/i.test(s)) return 2160;
    const achado = /\b(1080|720|576|540|480|360)p\b/i.exec(s);
    return achado ? Number(achado[1]) : 0;
}

// O MegaEmbed é o recurso que o addon usa quando não tem o episódio: ele
// devolve o episódio 1. Não é fonte da FrostStream e não pode entrar.
function ehFallback(stream) {
    const titulo = String(stream && stream.title || '');
    const nome = String(stream && stream.name || '');
    const grupo = String(stream && stream.behaviorHints && stream.behaviorHints.bingeGroup || '');
    const headers = JSON.stringify(stream && stream.headers || {});
    const url = String(stream && stream.url || '');
    return /megaembed/i.test(titulo)
        || /megaembed/i.test(nome)
        || /megaembed/i.test(grupo)
        || /megaembed\.com/i.test(headers)
        || /\.m3u8(\?|$)/i.test(url)
        || /youtu\.?be/i.test(url);
}

// Recebe os streams do addon e devolve só os que são do episódio pedido.
// Função pura para os testes; a decisão de rede fica em resolverTodos.
function escolherStreams(streams, { tipo = 'tv', temporada = 1, episodio = 1 } = {}) {
    const serie = tipo === 'tv' || tipo === 'series';
    const vistos = new Set();
    const lista = [];
    for (const bruto of Array.isArray(streams) ? streams : []) {
        const url = String(bruto && bruto.url || '');
        if (!/^https:\/\//i.test(url) || vistos.has(url) || ehFallback(bruto)) continue;
        if (serie) {
            const marcado = episodioDoTitulo(bruto.title);
            if (!marcado || marcado.temporada !== numero(temporada) || marcado.episodio !== numero(episodio)) continue;
        }
        vistos.add(url);
        const altura = alturaDoTexto(`${bruto.name || ''} ${bruto.title || ''}`);
        lista.push({
            url,
            altura,
            resolucao: altura ? altura + 'p' : '',
            nome: String(bruto.name || 'FrostStream'),
        });
    }
    return lista.sort((a, b) => b.altura - a.altura);
}

async function imdbDe(tmdbId, tipo) {
    const chave = `${tipo}:${tmdbId}`;
    const guardado = cacheImdb.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;
    try {
        const caminho = tipo === 'tv' ? 'tv' : 'movie';
        const r = await axios.get(`https://api.themoviedb.org/3/${caminho}/${tmdbId}/external_ids`, {
            params: { api_key: TMDB_KEY }, timeout: 10000,
        });
        const imdb = String(r.data && r.data.imdb_id || '');
        if (!/^tt\d{5,10}$/.test(imdb)) return null;
        cacheImdb.set(chave, { valor: imdb, expira: Date.now() + 24 * 60 * 60 * 1000 });
        return imdb;
    } catch { return null; }
}

// O endereço é conferido pelo próprio avaliador (sondagem por faixa de bytes,
// que segue os redirecionamentos). Não se repete a conferência aqui: o addon
// leva até ~12 s para completar a corrente de 302 e isso estouraria o prazo de
// abertura do player.

async function resolverTodos(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return [];
    const serie = tipo === 'tv' || tipo === 'series';
    const s = numero(temporada) || 1;
    const e = numero(episodio) || 1;
    const chave = serie ? `tv:${id}:${s}:${e}` : `movie:${id}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now() && !opcoes.semCache) return guardado.valor;

    const imdb = await imdbDe(id, serie ? 'tv' : 'movie');
    if (!imdb) return [];
    const caminho = serie ? `series/${imdb}:${s}:${e}.json` : `movie/${imdb}.json`;
    let streams = [];
    try {
        const r = await axios.get(`${BASE}/stream/${caminho}`, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            timeout: 8000,
            maxContentLength: 1024 * 1024,
            validateStatus: status => status < 500,
        });
        streams = r.data && Array.isArray(r.data.streams) ? r.data.streams : [];
    } catch { return []; }

    const escolhidos = escolherStreams(streams, { tipo: serie ? 'tv' : 'movie', temporada: s, episodio: e });
    if (!escolhidos.length) return [];
    const dados = escolhidos.map(item => ({
        url: item.url,
        audio: 'pt-BR',
        fonte: 'FrostStream · dublado',
        referer: BASE + '/',
        resolucao: item.resolucao,
        type: 'file',
        final: true,
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

module.exports = { resolver, resolverTodos, resolverEpisodio, escolherStreams, episodioDoTitulo, BASE };
