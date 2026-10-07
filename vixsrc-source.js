// Resolvedor do Vixsrc — traz o endereço direto do vídeo (HLS) para o nosso player.
// Portado do projeto TMDB-Embed-API (MIT), adaptado ao Conecta TV.
// Fluxo: API do site -> página de embed -> token/expires/playlist -> endereço final.
'use strict';
const axios = require('axios');

const BASE = 'https://vixsrc.to';
const CABECALHOS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Referer': BASE,
    'Origin': BASE,
};

function extrairDoHtml(html) {
    const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
    const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
    const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];
    if (!token || !expires || !playlist) return null;
    if (parseInt(expires, 10) * 1000 - 60000 < Date.now()) return null; // token vencido
    return { token, expires, playlist };
}

function melhorQualidade(playlist) {
    let melhor = 0;
    for (const linha of String(playlist || '').split('\n')) {
        const achado = linha.match(/RESOLUTION=\d+x(\d+)/);
        if (achado) melhor = Math.max(melhor, parseInt(achado[1], 10));
    }
    return melhor;
}

async function resolver(id, tipo = 'movie', temporada = null, episodio = null) {
    const rotaApi = tipo === 'tv' ? `/api/tv/${id}/${temporada}/${episodio}` : `/api/movie/${id}`;
    const respostaApi = await axios.get(BASE + rotaApi, { headers: CABECALHOS, timeout: 12000, responseType: 'json' });
    const src = respostaApi.data?.src;
    if (!src) throw new Error('Vixsrc não informou a página do player');

    const pagina = await axios.get(BASE + src, { headers: { ...CABECALHOS, Accept: 'text/html,application/xhtml+xml,*/*' }, timeout: 12000, responseType: 'text' });
    const dados = extrairDoHtml(String(pagina.data || ''));
    if (!dados) throw new Error('Vixsrc não entregou o token do vídeo');

    const separador = dados.playlist.includes('?') ? '&' : '?';
    const url = `${dados.playlist}${separador}token=${dados.token}&expires=${dados.expires}&h=1`;

    // lê o manifesto para saber a melhor qualidade e se há legendas
    let qualidade = 0, legendas = [];
    try {
        const manifesto = await axios.get(url, { headers: { ...CABECALHOS, Referer: BASE + rotaApi }, timeout: 12000, responseType: 'text' });
        qualidade = melhorQualidade(manifesto.data);
        legendas = [...String(manifesto.data || '').matchAll(/#EXT-X-MEDIA:TYPE=SUBTITLES[^\n]*NAME="([^"]+)"/g)].map(m => m[1]);
    } catch { /* segue sem a medição */ }

    return { url, qualidade: qualidade ? qualidade + 'p' : 'desconhecida', legendas, fonte: 'Vixsrc' };
}

module.exports = { resolver };
