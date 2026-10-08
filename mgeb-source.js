'use strict';
// Fonte dublada do provedor MGEB (mgeb.top), também chamado de MegaEmbed.
//
// Descoberto dentro do app.js do BRFlix (que revende esse provedor como
// "Servidor Principal"). O que faz ele servir para o Conecta TV:
//   - a página entrega a lista de vídeos no próprio HTML (sem navegador);
//   - não tem anúncio na página nem verificação de robô (conferido em 12
//     títulos seguidos, nenhuma rede de anúncio carregada);
//   - a primeira opção é um arquivo MP4 progressivo em HD, com áudio em
//     português ("por") — medido com ffprobe: 1280x720 nas séries e
//     1280x536 nos filmes widescreen;
//   - quando não há MP4, existe a opção em lista (HLS), com qualidade menor.
//
// Por ser dublado, limpo e em HD, ele entra como SEGUNDA opção do motor —
// logo atrás da fonte dublada principal, à frente das fontes de alta
// definição com legenda.

const axios = require('axios');

const BASE = 'https://mgeb.top';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VALIDADE = 3 * 60 * 60 * 1000;
const cache = new Map();

// Endereço antigo (lista de reprodução no HTML, sem a lista de opções).
// Só aceita endereço do próprio provedor (nada de link de terceiro).
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

// Padroniza o endereço da opção de vídeo: só aceita arquivo de vídeo (MP4) ou
// lista (M3U8); troca HTTP por HTTPS (o servidor de arquivos aceita os dois) e
// tira a porta 80 do caminho.
function limparEndereco(bruto) {
    const texto = String(bruto || '').trim().replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(texto)) return '';
    if (!/\.(mp4|m3u8)(\?|$)/i.test(texto)) return '';
    try {
        const url = new URL(texto);
        url.protocol = 'https:';
        url.port = '';
        return url.href;
    } catch { return ''; }
}

// A página do provedor entrega as opções na variável "sources". Ficamos com
// as que são arquivo/lista de vídeo — os itens de incorporação (iframe) são
// descartados. O MP4 vem primeiro por ser a opção em HD.
function extrairFontes(html) {
    const bloco = String(html || '').match(/var sources = (\[[\s\S]*?\]);/);
    if (!bloco) return [];
    let itens = [];
    try { itens = JSON.parse(bloco[1]); } catch { return []; }
    if (!Array.isArray(itens)) return [];

    const vistos = new Set();
    const mp4 = [];
    const hls = [];
    for (const item of itens) {
        const endereco = limparEndereco(item && item.file);
        if (!endereco || vistos.has(endereco)) continue;
        vistos.add(endereco);
        const lista = { url: endereco, label: String(item.label || '') };
        if (/\.mp4(\?|$)/i.test(endereco)) mp4.push(lista);
        else if (/\.m3u8(\?|$)/i.test(endereco)) hls.push(lista);
    }
    return [...mp4, ...hls];
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

    let dados = null;
    try {
        const html = await pegarPagina(caminho);
        const fonte = extrairFontes(html)[0];
        if (fonte) {
            const ehArquivo = /\.mp4(\?|$)/i.test(fonte.url);
            dados = {
                url: fonte.url,
                audio: 'pt-BR',
                fonte: 'MGEB · dublado',
                // O arquivo entregue pelo provedor tem 1280 pontos de largura
                // (classe 720p) e áudio em português; a lista é a opção menor.
                resolucao: ehArquivo ? '720p' : '',
                type: ehArquivo ? 'file' : 'hls',
                // Arquivo MP4 toca direto no player, sem encaminhamento.
                final: ehArquivo
            };
        } else {
            const url = extrairPlaylist(html);
            if (url) dados = { url, audio: 'pt-BR', fonte: 'MGEB · dublado', resolucao: '', type: 'hls' };
        }
    } catch { return null; }
    if (!dados) return null;

    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverEpisodio, extrairPlaylist, extrairFontes, limparEndereco, BASE };
