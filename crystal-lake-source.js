'use strict';
// Exceção por título. Não participa do ranking geral de fornecedores.
const ID = 'crystal-lake-dublado';
const ORIGIN = 'https://vaiquecol.com';
const REFERER = 'https://plenoflu.com/';
function seAplica(alvo) {
    return alvo?.tipo === 'tv' && String(alvo.tmdbId) === '213562' && String(alvo.temporada) === '1' && /^[1-8]$/.test(String(alvo.episodio));
}
function configuracao(html, episodio) {
    if (typeof html !== 'string' || html.length > 262144) return null;
    // Decodifica somente a tabela de palavras; nunca executa JavaScript externo.
    const packed = /return p\}\('((?:\\.|[^'\\])*)',62,(\d+),'([^']*)'\.split\('\|'\)/.exec(html);
    if (!packed || Number(packed[2]) > 2048) return null;
    let body = packed[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const words = packed[3].split('|');
    const encode = n => n < 62 ? n < 36 ? n.toString(36) : String.fromCharCode(n + 29) : encode(Math.floor(n / 62)) + encode(n % 62);
    for (let n = Number(packed[2]) - 1; n >= 0; n--) if (words[n]) body = body.replace(new RegExp('\\b' + encode(n) + '\\b', 'g'), () => words[n]);
    const call = /FirePlayer\("([a-f0-9]{32})",(\{[\s\S]*?\}),(?:false|true),source\)/.exec(body);
    if (!call) return null;
    try {
        const settings = JSON.parse(call[2]);
        if (settings.fields?.imdb !== `213562-1-${episodio}` || !Array.isArray(settings.advertising) || settings.advertising.length || settings.popactive !== false || String(settings.poplimit) !== '0' || settings.popurl !== '' || settings.p2p !== false) return null;
        return { hash: call[1] };
    } catch { return null; }
}
function linkSeguro(data, now = Date.now()) {
    try {
        const u = new URL(data.securedLink), source = new URL(data.videoSource);
        const match = /^\/cdn\/hls\/([a-f0-9]{32})\/master\.m3u8$/.exec(u.pathname);
        const expiry = Number(u.searchParams.get('expires')) * 1000;
        if (data.hls !== true || u.origin !== ORIGIN || u.username || u.password || u.hash || !match || source.href !== `${ORIGIN}/cdn/hls/${match[1]}/master.txt` || !/^[A-Za-z0-9_-]{22}$/.test(u.searchParams.get('md5') || '') || [...u.searchParams.keys()].sort().join(',') !== 'expires,md5' || !(expiry > now + 90000 && expiry <= now + 4 * 3600000)) return null;
        return { url: u.href, expiry };
    } catch { return null; }
}
function playlistPortuguesa(text) {
    if (typeof text !== 'string' || !text.startsWith('#EXTM3U') || text.length > 131072 || /#EXT-X-(?:DATERANGE|CUE-|DISCONTINUITY)|SCTE|INTERSTITIAL/i.test(text)) throw new Error('Lista recusada');
    const lines = text.split(/\r?\n/), kept = [];
    const groups = new Set(lines.filter(line => line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO') && /LANGUAGE="(?:por|pt(?:-BR)?)"/i.test(line)).map(line => /GROUP-ID="([^"]+)"/.exec(line)?.[1]).filter(Boolean));
    let portuguese = false, variant = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const group = /AUDIO="([^"]+)"/.exec(line)?.[1];
            const target = lines[++i];
            if (!target || target.startsWith('#')) throw new Error('Variante incompleta');
            if (!groups.has(group)) continue;
            const u = new URL(target);
            if (u.origin !== ORIGIN || u.username || u.password || u.hash || !/^\/hls\/[A-Za-z0-9%+/=_-]+$/.test(u.pathname)) throw new Error('Destino fora da fonte');
            variant = true;
            kept.push(line, target);
            continue;
        }
        if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) continue;
        if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
            if (!/LANGUAGE="(?:por|pt(?:-BR)?)"/i.test(line)) continue;
            portuguese = true;
            kept.push(line.replace(/DEFAULT=(?:YES|NO)/, 'DEFAULT=YES'));
        } else kept.push(line);
        const targets = line.startsWith('#') ? [...line.matchAll(/URI="([^"]+)"/g)].map(m => m[1]) : line.trim() ? [line.trim()] : [];
        for (const target of targets) {
            const u = new URL(target);
            if (u.origin !== ORIGIN || u.username || u.password || u.hash || !/^\/hls\/[A-Za-z0-9%+/=_-]+$/.test(u.pathname)) throw new Error('Destino fora da fonte');
        }
    }
    if (!portuguese || !variant) throw new Error('Sem faixa portuguesa');
    return kept.join('\n');
}
function qualidadeDaPlaylist(playlist) {
    let largura = 0, altura = 0, melhor = 0;
    for (const line of playlist.split(/\r?\n/)) {
        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
        const match = /RESOLUTION=(\d{2,5})x(\d{2,5})/i.exec(line);
        if (!match) continue;
        const w = Number(match[1]), h = Number(match[2]);
        const qualidade = Math.max(Math.min(w, h), Math.max(w, h) * 9 / 16);
        if (qualidade > melhor) { melhor = qualidade; largura = w; altura = h; }
    }
    return { largura, altura, resolucao: melhor > 0 ? `${Math.round(melhor)}p` : '' };
}
function listaMediaLimpa(text) {
    if (typeof text !== 'string' || !text.startsWith('#EXTM3U') || !text.includes('#EXT-X-ENDLIST') || /#EXT-X-(?:DATERANGE|CUE-|DISCONTINUITY)|SCTE|INTERSTITIAL/i.test(text)) return false;
    const segments = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    return segments.length > 0 && segments.every(value => {
        try { const u = new URL(value); return u.protocol === 'https:' && /^nense(?:c|[f-i]|[l-u])\.xyz$/.test(u.hostname) && !u.username && !u.password && !u.port && !u.hash; } catch { return false; }
    });
}
function criar({ get, post, now = Date.now } = {}) {
    const axios = require('axios');
    const options = { timeout: 5000, maxRedirects: 0, maxContentLength: 262144, responseType: 'text', validateStatus: s => s === 200 };
    get ||= async (url, referer, signal) => (await axios.get(url, { ...options, signal, headers: { Referer: referer, Accept: '*/*' } })).data;
    post ||= async (url, body, referer, signal) => (await axios.post(url, body, { ...options, signal, headers: { Referer: referer, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } })).data;
    const cache = new Map(), inflight = new Map();
    async function obter(episodio, atualizar = false) {
        if (!/^[1-8]$/.test(String(episodio))) throw new Error('Episódio fora da exceção');
        const previous = cache.get(String(episodio));
        if (!atualizar && previous && previous.until > now()) return previous;
        if (inflight.has(String(episodio))) return inflight.get(String(episodio));
        const task = (async () => {
            const signal = AbortSignal.timeout(14000);
            const embed = `${ORIGIN}/embed2/213562-1-${episodio}`;
            const config = configuracao(await get(embed, REFERER, signal), episodio);
            if (!config) throw new Error('Configuração não aprovada');
            const raw = await post(`${ORIGIN}/player/index.php?data=${config.hash}&do=getVideo`, new URLSearchParams({ hash: config.hash, r: REFERER }).toString(), embed, signal);
            const link = linkSeguro(typeof raw === 'string' ? JSON.parse(raw) : raw, now());
            if (!link) throw new Error('Endereço não aprovado');
            const playlist = playlistPortuguesa(await get(link.url, '', signal));
            const children = [...new Set([...playlist.matchAll(/URI="([^"]+)"/g)].map(m => m[1]).concat(playlist.split('\n').filter(l => l && !l.startsWith('#'))))];
            if (children.length > 16 || !(await Promise.all(children.map(async url => listaMediaLimpa(await get(url, '', signal))))).every(Boolean)) throw new Error('Lista de mídia não aprovada');
            const item = { ...link, playlist, ...qualidadeDaPlaylist(playlist), until: Math.min(now() + 300000, link.expiry - 90000) };
            cache.set(String(episodio), item);
            return item;
        })();
        inflight.set(String(episodio), task);
        try { return await task; } finally { inflight.delete(String(episodio)); }
    }
    async function resolver(alvo, { exceto = [] } = {}) {
        if (!seAplica(alvo) || exceto.includes(ID)) return null;
        try {
            const atual = await obter(alvo.episodio, true);
            return { url: `/api/crystal-lake/1/${alvo.episodio}/master.m3u8`, final: true, audio: 'pt-BR', fonte: 'Crystal Lake · dublado', fonteId: ID, type: 'hls', resolucao: atual.resolucao, largura: atual.largura, altura: atual.altura };
        } catch { return null; }
    }
    async function playlist(episodio) {
        const item = await obter(episodio), midia = require('./midia-proxy');
        midia.liberarHost('vaiquecol.com');
        return midia.reescreverPlaylist(item.playlist, item.url, '');
    }
    return { resolver, playlist };
}
module.exports = { ID, seAplica, configuracao, linkSeguro, playlistPortuguesa, qualidadeDaPlaylist, listaMediaLimpa, criar, ...criar() };
