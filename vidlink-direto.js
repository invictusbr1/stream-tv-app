'use strict';
// Última alternativa limpa: somente o arquivo de mídia, sem incorporar a
// página do fornecedor. Não altera as fontes dubladas nem o Vixsrc existente.
// Fluxo público de referência: Inside4ndroid/TMDB-Embed-API/providers/vidlink.js (MIT).
const axios = require('axios');
const midia = require('./midia-proxy');

function escolherArquivo(stream) {
    if (!stream || stream.type !== 'file') return null;
    return Object.entries(stream.qualities || {}).map(([qualidade, item]) => {
        const altura = /^4k$/i.test(qualidade) ? 2160 : Number.parseInt(qualidade, 10);
        if (!item || !Number.isFinite(altura) || altura < 720 || item.type !== 'mp4') return null;
        let url;
        try { url = new URL(item.url); } catch { return null; }
        if (url.protocol !== 'https:' || url.port || url.username || url.password
            || !/(^|\.)hakunaymatata\.com$/i.test(url.hostname) || !/\.mp4$/i.test(url.pathname)) return null;
        if (item.codecName && !/^(h264|avc|avc1)$/i.test(item.codecName)) return null;
        return { ...item, url: url.href, altura };
    }).filter(Boolean).sort((a, b) => b.altura - a.altura)[0] || null;
}

async function resolver(alvo) {
    const id = String(alvo?.tmdbId || '');
    const tv = alvo?.tipo === 'tv';
    if (!/^[1-9]\d{0,9}$/.test(id) || (tv && (!/^[1-9]\d{0,2}$/.test(String(alvo.temporada)) || !/^[1-9]\d{0,3}$/.test(String(alvo.episodio))))) return null;
    try {
        const codificado = await axios.get('https://enc-dec.app/api/enc-vidlink', {
            params: { text: id }, timeout: 8000, maxContentLength: 32768,
        });
        const codigo = codificado.data?.result;
        if (typeof codigo !== 'string' || codigo.length > 4096 || !codigo) return null;
        const rota = tv ? `tv/${encodeURIComponent(codigo)}/${alvo.temporada}/${alvo.episodio}` : `movie/${encodeURIComponent(codigo)}`;
        const resposta = await axios.get('https://vidlink.pro/api/b/' + rota, {
            params: { multiLang: 0 }, headers: { Referer: 'https://vidlink.pro', Accept: 'application/json' },
            timeout: 8000, maxContentLength: 1024 * 1024,
        });
        const stream = resposta.data?.stream, arquivo = escolherArquivo(stream);
        if (!arquivo) return null;
        const validadeMs = Math.max(1000, Math.min(300, Number(stream.TTL) || 300) * 1000);
        midia.liberarHost(new URL(arquivo.url).hostname);
        midia.registrarCabecalhos(arquivo.url, arquivo.headers, (Number(stream.TTL) || 3600) * 1000);
        return { url: arquivo.url, audio: 'original', fonte: 'VidLink · arquivo sem anúncios',
            type: 'file', resolucao: arquivo.altura + 'p', validadeMs, tempoValidacaoMs: 12000, legendas: [], legendaPortugues: false };
    } catch { return null; }
}

module.exports = { resolver, escolherArquivo };
