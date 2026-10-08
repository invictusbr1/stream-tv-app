'use strict';
// Fonte dublada do agregador FenixFlix (addon público, provedor "Hollymovies").
//
// Medido em 08/10/2026:
//   - entrega lista HLS (720p/360p) que o navegador toca com som;
//   - o arquivo rotulado "🇧🇷 Dublado" foi conferido por transcrição do áudio
//     ("Que te faça sentir vivo…") — português de verdade;
//   - não abre página com anúncio: o endereço do vídeo vai direto ao player;
//   - o catálogo é pequeno em HLS (2 de 12 filmes testados) e alguns títulos
//     só existem em MKV (que o navegador toca mudo) — esses são recusados aqui;
//   - o endereço é assinado e expira, então a memória é curta.

const axios = require('axios');

const BASE = 'https://fenixflix.fenixhub.online';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const VALIDADE = 40 * 60 * 1000;

const cache = new Map();
const cacheImdb = new Map();

async function imdbDe(tmdbId, tipo) {
    const chave = `${tipo}:${tmdbId}`;
    const guardado = cacheImdb.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;
    try {
        const caminho = tipo === 'tv' ? `tv/${tmdbId}` : `movie/${tmdbId}`;
        const r = await axios.get(`https://api.themoviedb.org/3/${caminho}/external_ids`, {
            params: { api_key: TMDB_KEY }, timeout: 12000,
        });
        const imdb = String(r.data && r.data.imdb_id || '');
        if (!/^tt\d{5,10}$/.test(imdb)) return null;
        cacheImdb.set(chave, { valor: imdb, expira: Date.now() + 24 * 60 * 60 * 1000 });
        return imdb;
    } catch { return null; }
}

// Escolhe a melhor opção: HLS com rótulo dublado; se não houver, o primeiro
// HLS. Endereços que não são lista (páginas, MKV) são descartados.
function escolherStream(streams) {
    const lista = Array.isArray(streams) ? streams : [];
    const hls = lista.filter(s => s && typeof s.url === 'string' && /\.m3u8(\?|$)/i.test(s.url));
    if (!hls.length) return null;
    return hls.find(s => /dublado|dual/i.test(String(s.title || '') + ' ' + String(s.name || ''))) || hls[0];
}

// Quando não existe lista HLS, o addon publica o mesmo filme em MKV (1080p,
// com faixa em português). O navegador toca esse arquivo SEM SOM, mas o
// aplicativo consegue convertê-lo (o vídeo é copiado; só o áudio vira AAC) —
// por isso ele também é oferecido, marcado como "conversão".
function escolherParaConversao(streams) {
    const lista = Array.isArray(streams) ? streams : [];
    const arquivos = lista.filter(s => s && typeof s.url === 'string' && /\.(mkv|mp4)(\?|$)/i.test(s.url));
    if (!arquivos.length) return null;
    return arquivos.find(s => /dublado|dual/i.test(String(s.title || '') + ' ' + String(s.name || ''))) || arquivos[0];
}

async function resolver(tipo, tmdbId, temporada, episodio) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return null;
    const ehSerie = tipo === 'tv';
    const chave = ehSerie ? `tv:${id}:${temporada || 1}:${episodio || 1}` : `movie:${id}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;

    const imdb = await imdbDe(id, ehSerie ? 'tv' : 'movie');
    if (!imdb) return null;
    const caminho = ehSerie
        ? `/stream/series/${imdb}:${temporada || 1}:${episodio || 1}.json`
        : `/stream/movie/${imdb}.json`;
    let dados = null;
    try {
        const r = await axios.get(BASE + caminho, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 15000, validateStatus: s => s < 500 });
        const escolhido = escolherStream(r.data && r.data.streams);
        const paraConversao = escolhido ? null : escolherParaConversao(r.data && r.data.streams);
        if (escolhido) {
            dados = {
                url: escolhido.url,
                audio: 'pt-BR',
                fonte: 'FenixFlix · dublado',
                resolucao: '720p',
                type: 'hls',
                validadeMs: VALIDADE,
            };
        } else if (paraConversao) {
            dados = {
                url: paraConversao.url,
                audio: 'pt-BR',
                fonte: 'FenixFlix · 1080p (conversão)',
                resolucao: '1080p',
                type: 'convertido',
                converter: true,
                validadeMs: VALIDADE,
            };
        }
    } catch { return null; }
    if (!dados) return null;
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverEpisodio, escolherStream, escolherParaConversao, imdbDe, BASE };
