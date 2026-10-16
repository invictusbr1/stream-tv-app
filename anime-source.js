'use strict';

// Adaptador restrito a animes com identidade e numeração já conferidas.
// O vídeo permanece no player público Blogger: não extraímos nem guardamos
// endereços Googlevideo temporários e não interferimos nas fontes de séries.
const axios = require('axios');

const API = 'https://serv01.meusdoramas.club/posts/get-video.php';
const TMDB = 'https://api.themoviedb.org/3';
const SITE = 'https://meusanimes.blog';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PRAZO_MS = 20000;
const CACHE_VIDEO_MS = 2 * 60 * 1000;
const CACHE_METADATA_MS = 10 * 60 * 1000;
const LIMITE_CACHE = 128;

// Página, iframe e rótulo Legendado conferidos em 12/10/2026. Novos títulos
// precisam de uma ponte conferida; uma busca aproximada não pode abrir outro
// anime nem outro episódio. Estes registros não contêm URLs de reprodução.
const CATALOGO = Object.freeze({
    '37854': Object.freeze({ slug: 'one-piece', numeracao: 'absoluta' }),
    '127532': Object.freeze({ slug: 'solo-leveling', numeracao: 'solo-12-13' })
});

function inteiro(valor, limite) {
    const texto = String(valor ?? '').trim();
    if (!/^[1-9]\d*$/.test(texto) || texto.length > 10) return null;
    const numero = Number(texto);
    return Number.isSafeInteger(numero) && numero <= limite ? numero : null;
}

function validarAnime(dados, id) {
    if (!dados || String(dados.id) !== String(id) || !Array.isArray(dados.genres)) return false;
    const animacao = dados.genres.some(g => Number(g && g.id) === 16);
    const paises = Array.isArray(dados.origin_country) ? dados.origin_country : [];
    return animacao && (paises.some(p => p === 'JP' || p === 'KR') || dados.original_language === 'ja');
}

function validarBlogger(valor) {
    if (typeof valor !== 'string' || valor.length > 4096) return null;
    let url;
    try { url = new URL(valor); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'www.blogger.com' || url.port ||
        url.username || url.password || url.pathname !== '/video.g' || url.hash) return null;
    if (url.searchParams.getAll('token').length !== 1 ||
        !/^[A-Za-z0-9_-]{20,2048}$/.test(url.searchParams.get('token') || '') ||
        [...url.searchParams.keys()].some(chave => chave !== 'token')) return null;
    // Mantém os parâmetros publicados pelo fornecedor, sem reconstruir token.
    return valor;
}

function episodioFornecedor(id, temporada, episodio, dadosTemporada) {
    const ficha = CATALOGO[String(id)];
    if (!ficha || !dadosTemporada || Number(dadosTemporada.season_number) !== temporada ||
        !Array.isArray(dadosTemporada.episodes)) return null;
    const encontrado = dadosTemporada.episodes.find(e => e && Number(e.episode_number) === episodio &&
        Number(e.season_number) === temporada);
    if (!encontrado) return null;
    if (ficha.numeracao === 'absoluta') {
        // One Piece no TMDB já usa números absolutos nas temporadas seguintes.
        // Ex.: T23 E1180 vira T1 E1180; T23 E1 nunca vira o primeiro episódio.
        if (temporada > 1 && episodio <= 61) return null;
        return { temporada: 1, episodio };
    }
    // O TMDB publica Solo Leveling como T1 E1–25. O fornecedor separa os
    // primeiros 12 episódios e os 13 seguintes em duas temporadas.
    if (temporada !== 1 || episodio > 25) return null;
    return episodio <= 12
        ? { temporada: 1, episodio }
        : { temporada: 2, episodio: episodio - 12 };
}

function criarResolvedor({ get = axios.get.bind(axios), agora = Date.now } = {}) {
    const cacheVideo = new Map();
    const cacheMetadata = new Map();

    function ler(cache, chave) {
        const registro = cache.get(chave);
        if (!registro) return null;
        if (registro.expira <= agora()) { cache.delete(chave); return null; }
        return registro.valor;
    }
    function guardar(cache, chave, valor, validade) {
        for (const [id, registro] of cache) if (registro.expira <= agora()) cache.delete(id);
        cache.delete(chave);
        while (cache.size >= LIMITE_CACHE) cache.delete(cache.keys().next().value);
        cache.set(chave, { valor, expira: agora() + validade });
    }

    async function resolverEpisodio({ tmdbId, temporada, episodio, audio = 'legendado', tmdbKey, signal } = {}) {
        const id = inteiro(tmdbId, 9999999999);
        const t = inteiro(temporada, 999);
        const e = inteiro(episodio, 9999);
        if (!id || !t || !e || !CATALOGO[String(id)] ||
            !['legendado', 'original'].includes(audio) || signal?.aborted ||
            typeof tmdbKey !== 'string' || !/^[A-Za-z0-9_-]{10,80}$/.test(tmdbKey)) return null;

        const controller = new AbortController();
        const cancelar = () => controller.abort();
        const fim = agora() + PRAZO_MS;
        signal?.addEventListener('abort', cancelar, { once: true });
        const timer = setTimeout(cancelar, PRAZO_MS);
        timer.unref?.();
        // A conexão pode ter sido cancelada entre a validação e o listener.
        if (signal?.aborted) controller.abort();

        async function consultar(url, params, maxContentLength) {
            const restante = fim - agora();
            if (controller.signal.aborted || restante <= 0) return null;
            const resposta = await get(url, {
                params, signal: controller.signal, timeout: Math.min(PRAZO_MS, restante),
                headers: { 'User-Agent': UA, Accept: 'application/json', Referer: `${SITE}/` },
                responseType: 'json', maxContentLength, maxRedirects: 0,
                validateStatus: s => s === 200
            });
            if (controller.signal.aborted || agora() >= fim || resposta?.status !== 200) return null;
            const dados = resposta.data;
            if (typeof dados !== 'string') return dados && typeof dados === 'object' ? dados : null;
            if (Buffer.byteLength(dados) > maxContentLength) return null;
            try { return JSON.parse(dados); } catch { return null; }
        }

        async function metadados(caminho) {
            const salvo = ler(cacheMetadata, caminho);
            if (salvo) return salvo;
            const dados = await consultar(`${TMDB}${caminho}`, { api_key: tmdbKey }, 1024 * 1024);
            if (dados) guardar(cacheMetadata, caminho, dados, CACHE_METADATA_MS);
            return dados;
        }

        try {
            const anime = await metadados(`/tv/${id}`);
            if (controller.signal.aborted || !validarAnime(anime, id)) return null;
            const temporadaDados = await metadados(`/tv/${id}/season/${t}`);
            const ponte = episodioFornecedor(id, t, e, temporadaDados);
            if (controller.signal.aborted || !ponte) return null;
            const chave = `${id}:${ponte.temporada}:${ponte.episodio}:legendado`;
            let url = ler(cacheVideo, chave);
            if (!url) {
                const dados = await consultar(API, {
                    episode_number: ponte.episodio, season_number: ponte.temporada, tmdb: id
                }, 32 * 1024);
                if (!dados || dados.success !== true) return null;
                url = validarBlogger(dados.videoUrl);
                if (!url) return null;
                guardar(cacheVideo, chave, url, CACHE_VIDEO_MS);
            }
            if (controller.signal.aborted || agora() >= fim) return null;
            const pagina = `${SITE}/e/${CATALOGO[String(id)].slug}-${ponte.temporada}-episodio-${ponte.episodio}/`;
            return {
                ok: true, tipo: 'embed', type: 'embed', embed: true, url,
                supplierId: 'meus-animes', fonteId: 'meus-animes',
                source: 'Meus Animes · legendado', nome: 'Meus Animes · legendado',
                audio: 'original', legendado: true, legenda: 'pt-BR',
                legendaPortugues: true, legendaEmbutida: true, anime: true,
                episode: { season: t, number: e },
                providerEpisode: { season: ponte.temporada, number: ponte.episodio },
                pagina, validadeMs: CACHE_VIDEO_MS
            };
        } catch {
            // Indisponibilidade deste adaptador deixa as demais fontes intactas.
            return null;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancelar);
        }
    }

    return { resolverEpisodio };
}

const resolvedor = criarResolvedor();
module.exports = { resolverEpisodio: resolvedor.resolverEpisodio, criarResolvedor, validarAnime, validarBlogger, episodioFornecedor };
