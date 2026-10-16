'use strict';
// Somente MP4 no player do aplicativo. Nenhuma página/script/iframe é executado.
const axios = require('axios');
const SITE = 'https://assistiranimesonline.net';
const MEDIA_HOST = 'meusanimes.blog.alibabacdn.net';
const SOURCE_ID = 'proplayer-legendado';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ADS = /\b(?:popunder|popads|popcash|adsterra|monetag|outbrain|taboola|doubleclick|googlesyndication)\b|advertising\s*:|\b(?:vast|vmap)\s*[:=]/i;
function inteiro(v, max) { return /^[1-9]\d{0,8}$/.test(String(v ?? '')) && Number(v) <= max ? Number(v) : null; }
function slug(nome) { return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180); }
function urlSegura(valor, host) {
    try { const u = new URL(valor); return u.protocol === 'https:' && u.hostname === host && !u.port && !u.username && !u.password && !u.hash ? u : null; } catch { return null; }
}
function validarMidia(valor, caminho) {
    const u = urlSegura(valor, MEDIA_HOST);
    if (!u || !/^\/video\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9._-]*mp4$/.test(u.pathname) || (caminho && u.pathname !== '/' + caminho)) return null;
    if (!/^[a-f0-9]{64}$/.test(u.searchParams.get('X-Amz-Signature') || '') || !/^\d{8}T\d{6}Z$/.test(u.searchParams.get('X-Amz-Date') || '') || !inteiro(u.searchParams.get('X-Amz-Expires'), 10800)) return null;
    if ([...u.searchParams.keys()].some(k => !/^X-Amz-(Algorithm|Credential|Date|Expires|SignedHeaders|Signature)$/.test(k))) return null;
    return u.href;
}
function playerDaPagina(html, id, t, e) {
    if (ADS.test(html)) return null;
    const identidade = `https://myembed.biz/serie/${id}/${t}/${e}`;
    const botoes = [...String(html).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
    if (!botoes.some(b => /data-provider=["']myembed["']/i.test(b[1]) && new RegExp('data-player-url=["\']' + identidade.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(b[1]))) return null;
    const candidatos = botoes.filter(b => /data-provider=["']proplayer_leg["']/i.test(b[1]) && /PROPLAYER\s+LEG/i.test(b[2].replace(/<[^>]*>/g, ' ')))
        .map(b => /data-player-url=["']([^"']+)["']/i.exec(b[1])?.[1].replace(/&amp;/g, '&'));
    const unicos = [...new Set(candidatos)];
    if (unicos.length !== 1) return null;
    const u = urlSegura(unicos[0], 'sk-ru.alibabacdn.net');
    const caminho = u?.searchParams.get('id') || '';
    if (!u || u.pathname !== '/' || !/^video\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9._-]*mp4$/.test(caminho) || u.searchParams.getAll('id').length !== 1) return null;
    return { url: u.href, caminho };
}
function arquivoDoPlayer(html, caminho) {
    if (ADS.test(html)) return null;
    const trecho = /\bsources\s*:\s*(\[[^\r\n]*\])/i.exec(html)?.[1];
    try {
        const fontes = JSON.parse(trecho).filter(f => f && f.type === 'video/mp4' && /^\d{3,4}p$/.test(f.label) && Number(f.label.slice(0, -1)) >= 720)
            .map(f => ({ url: validarMidia(f.file, caminho), altura: Number(f.label.slice(0, -1)) })).filter(f => f.url);
        return fontes.sort((a, b) => b.altura - a.altura)[0] || null;
    } catch { return null; }
}
function episodioAbsoluto(meta, temporada, episodio, numeros) {
    if (!Array.isArray(numeros) || !numeros.includes(episodio)) return null;
    if (Math.min(...numeros) > 1) return episodio;
    let total = episodio;
    for (let t = 1; t < temporada; t++) {
        const anterior = meta.seasons?.find(s => s.season_number === t);
        if (!inteiro(anterior?.episode_count, 2000)) return null;
        total += anterior.episode_count;
    }
    return total <= 10000 ? total : null;
}
function criarResolvedor({ get = axios.get.bind(axios) } = {}) {
    async function resolverEpisodio({ tmdbId, temporada, episodio, audio = 'legendado', tmdbKey, signal } = {}) {
        const id = inteiro(tmdbId, 999999999), t = inteiro(temporada, 999), e = inteiro(episodio, 9999);
        if (!id || !t || !e || audio !== 'legendado' || signal?.aborted || typeof tmdbKey !== 'string' || !/^[A-Za-z0-9_-]{10,80}$/.test(tmdbKey)) return null;
        const controller = new AbortController(), cancelar = () => controller.abort();
        signal?.addEventListener('abort', cancelar, { once: true });
        const timer = setTimeout(cancelar, 20000); timer.unref?.();
        if (signal?.aborted) cancelar();
        async function ler(url, params, referer = '', max = 1048576) {
            if (controller.signal.aborted) throw Error('cancelado');
            const r = await get(url, { params, headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) }, signal: controller.signal,
                timeout: 6000, maxRedirects: 0, maxContentLength: max, responseType: params ? 'json' : 'text', validateStatus: s => s === 200 });
            if (controller.signal.aborted || r.status !== 200) throw Error('indisponivel');
            return r.data;
        }
        try {
            const meta = await ler(`https://api.themoviedb.org/3/tv/${id}`, { api_key: tmdbKey, language: 'en-US' });
            if (!require('./anime-source').validarAnime(meta, id)) return null;
            const season = await ler(`https://api.themoviedb.org/3/tv/${id}/season/${t}`, { api_key: tmdbKey });
            if (season?.season_number !== t || !Array.isArray(season.episodes) || season.episodes.length > 2000) return null;
            const numeros = season.episodes.filter(x => x.season_number === t).map(x => x.episode_number);
            const numero = episodioAbsoluto(meta, t, e, numeros), nome = slug(meta.name);
            if (!numero || !nome) return null;
            const pagina = `${SITE}/episodio/${nome}-episodio-${numero}/`;
            const html = String(await ler(pagina));
            const player = playerDaPagina(html, id, t, e);
            if (!player) return null;
            const arquivo = arquivoDoPlayer(String(await ler(player.url, null, pagina, 262144)), player.caminho);
            if (!arquivo || controller.signal.aborted) return null;
            return { ok: true, tipo: 'file', type: 'file', tmdbId: id, url: arquivo.url, fonteId: SOURCE_ID, supplierId: SOURCE_ID,
                source: 'PROPLAYER · legendado', nome: 'PROPLAYER · legendado', audio: 'original', audioInformado: 'Legendado · português',
                anime: true, semAnuncio: true, legendaPortugues: true, legendaEmbutida: true, pagina,
                qualidade: arquivo.altura + 'p', episode: { season: t, number: e }, providerEpisode: numero };
        } catch { return null; }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', cancelar); }
    }
    return { resolverEpisodio };
}
module.exports = { ...criarResolvedor(), criarResolvedor, validarMidia, playerDaPagina, arquivoDoPlayer, episodioAbsoluto, SOURCE_ID };
