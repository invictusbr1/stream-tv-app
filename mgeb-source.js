'use strict';
// Fonte dublada do provedor MGEB (mgeb.top).
//
// Descoberto dentro do app.js do BRFlix (que revende esse provedor como
// "Servidor Principal"). O que faz ele servir para o Conecta TV:
//   - a página entrega o endereço do vídeo no próprio HTML (sem navegador);
//   - não tem anúncio na página nem verificação de robô;
//   - nos animes entrega 720p com faixa de áudio em português ("por").
// Nas séries a qualidade medida foi menor (até 480p), por isso ele entra como
// SEGUNDA opção: só é usado quando a fonte dublada principal não tem o título.

const axios = require('axios');

const BASE = 'https://mgeb.top';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VALIDADE = 3 * 60 * 60 * 1000;
const cache = new Map();

// Só aceita endereço de vídeo do próprio provedor (nada de link de terceiro).
function extrairPlaylist(html) {
    const achado = String(html || '').match(/https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/i);
    if (!achado) return '';
    const endereco = achado[0].replace(/\/\.\.\//g, '/');
    try {
        const url = new URL(endereco);
        if (!/(^|\.)mgeb\.top$/i.test(url.hostname)) return '';
        return url.href;
    } catch { return ''; }
}

async function pegarPagina(caminho) {
    const resposta = await axios.get(BASE + caminho, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9', Referer: BASE + '/' },
        timeout: 15000,
        responseType: 'text',
        maxContentLength: 4 * 1024 * 1024,
        validateStatus: status => status === 200
    });
    return String(resposta.data || '');
}

async function resolver(tipo, tmdbId, temporada, episodio) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return null;
    const ehSerie = tipo === 'tv';
    const caminho = ehSerie ? `/embed/${id}/${temporada || 1}/${episodio || 1}` : `/embed/${id}`;
    const chave = ehSerie ? `tv:${id}:${temporada}:${episodio}` : `movie:${id}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;

    let url = '';
    try {
        const html = await pegarPagina(caminho);
        url = extrairPlaylist(html);
    } catch { return null; }
    if (!url) return null;

    const dados = { url, audio: 'pt-BR', fonte: 'MGEB · dublado', resolucao: '', type: 'hls' };
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverEpisodio, extrairPlaylist, BASE };
