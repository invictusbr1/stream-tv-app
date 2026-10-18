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
//   - quando não há MP4, existe a opção em lista (HLS). A qualidade varia por
//     título; o avaliador confere a resolução oferecida em cada abertura.
//
// Por ser dublado, limpo e em HD, ele entra como SEGUNDA opção do motor —
// logo atrás da fonte dublada principal, à frente das fontes de alta
// definição com legenda.

const axios = require('axios');
const https = require('node:https');

// O domínio do MGEB muda de tempo em tempo (mgeb.top → mgeb.site em 18/10/2026).
// Tenta o mais novo primeiro e mantém o anterior como reserva.
const BASES = ['https://mgeb.site', 'https://mgeb.top'];
const BASE = BASES[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VALIDADE = 3 * 60 * 60 * 1000;
const cache = new Map();
// Apenas a leitura da página fixa deste fornecedor usa IPv4: algumas redes
// anunciam um IPv6 que não responde. Não muda o agente das outras fontes.
const AGENTE_PAGINA = new https.Agent({ family: 4 });

// Endereço antigo (lista de reprodução no HTML, sem a lista de opções).
// Só aceita endereço do próprio provedor (nada de link de terceiro).
function extrairPlaylist(html) {
    const achado = String(html || '').match(/https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/i);
    if (!achado) return '';
    const endereco = achado[0].replace(/\/\.\.\//g, '/');
    try {
        const url = new URL(endereco);
        if (!/(^|\.)mgeb\.(?:top|site)$/i.test(url.hostname)) return '';
        return url.href;
    } catch { return ''; }
}

// Classifica o endereço pelo que ele entrega, não só pela extensão: alguns
// servidores do fornecedor escondem o arquivo/lista atrás de um script.
//   - streamtape.com/get_video?id=...            → arquivo MP4
//   - *.playercdnx.workers.dev/includes/hls.php  → lista HLS
function tipoDoEndereco(endereco) {
    const texto = String(endereco || '');
    if (/\.mp4(\?|$)/i.test(texto)) return 'file';
    if (/\.m3u8(\?|$)/i.test(texto)) return 'hls';
    try {
        const url = new URL(texto);
        if (/(^|\.)streamtape\.com$/i.test(url.hostname)) return 'file';
        if (/playercdnx\.workers\.dev$/i.test(url.hostname) || /\/hls\.php$/i.test(url.pathname)) return 'hls';
    } catch { /* segue sem tipo */ }
    return '';
}

// Padroniza o endereço da opção de vídeo: troca HTTP por HTTPS (o servidor de
// arquivos aceita os dois) e tira a porta 80 do caminho.
// O disco www-fontedecanais-live.77zzhf54vdll71.com fica de fora: em 18/10/2026
// ele passou a responder 403 "Limite de 20 TB atingido" em TODOS os títulos,
// então ele não é mais uma opção — nem para medir, nem para tocar.
function limparEndereco(bruto) {
    const texto = String(bruto || '').trim().replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(texto)) return '';
    if (!tipoDoEndereco(texto)) return '';
    try {
        const url = new URL(texto);
        if (/(^|\.)77zzhf54vdll71\.com$/i.test(url.hostname) || /fontedecanais/i.test(url.hostname)) return '';
        url.protocol = 'https:';
        url.port = '';
        return url.href;
    } catch { return ''; }
}

// A página do provedor entrega as opções na variável "sources". Ficamos com
// as que são arquivo/lista de vídeo — os itens de incorporação (iframe) são
// descartados. Quando o fornecedor declara resolução, a maior vem primeiro;
// sem essa indicação, mantém a preferência histórica pelo MP4.
function alturaDoRotulo(label) {
    const texto = String(label || '').trim();
    const altura = texto.match(/\b(2160|1440|1080|720|576|540|480|360|240|180)\s*p\b/i)
        || texto.match(/^(2160|1440|1080|720|576|540|480|360|240|180)$/);
    return altura ? Number(altura[1]) : 0;
}

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
        const tipo = tipoDoEndereco(endereco);
        if (tipo === 'file') mp4.push(lista);
        else if (tipo === 'hls') hls.push(lista);
    }
    return [...mp4, ...hls].sort((a, b) => alturaDoRotulo(b.label) - alturaDoRotulo(a.label));
}

async function pegarPagina(caminho) {
    let ultimo = null;
    for (const base of BASES) {
        try {
            const resposta = await axios.get(base + caminho, {
                headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9', Referer: base + '/' },
                timeout: 15000,
                httpsAgent: AGENTE_PAGINA,
                responseType: 'text',
                maxContentLength: 4 * 1024 * 1024,
                validateStatus: status => status === 200
            });
            return { html: String(resposta.data || ''), base };
        } catch (erro) { ultimo = erro; }
    }
    throw ultimo || new Error('MGEB não respondeu');
}

async function resolverTodos(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return [];
    const ehSerie = tipo === 'tv';
    const caminho = ehSerie ? `/embed/${id}/${temporada || 1}/${episodio || 1}` : `/embed/${id}`;
    const chave = ehSerie ? `tv:${id}:${temporada}:${episodio}` : `movie:${id}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now() && !opcoes.semCache) return guardado.valor;

    let dados = [];
    try {
        const pagina = await pegarPagina(caminho);
        const html = pagina.html;
        const base = pagina.base;
        const fontes = extrairFontes(html).slice(0, 8);
        if (fontes.length) {
            dados = fontes.map(fonte => {
                const ehArquivo = tipoDoEndereco(fonte.url) === 'file';
                return {
                    url: fonte.url,
                    audio: 'pt-BR',
                    fonte: 'MGEB · dublado',
                    referer: base + '/',
                    // É a indicação do fornecedor, não uma medição. O avaliador
                    // usa a altura real quando a sondagem consegue responder.
                    resolucao: alturaDoRotulo(fonte.label) ? alturaDoRotulo(fonte.label) + 'p' : '',
                    type: ehArquivo ? 'file' : 'hls',
                    // Arquivo MP4 toca direto no player, sem encaminhamento.
                    final: ehArquivo
                };
            });
        } else {
            const url = extrairPlaylist(html);
            if (url) dados = [{ url, audio: 'pt-BR', fonte: 'MGEB · dublado', referer: base + '/', resolucao: '', type: 'hls' }];
        }
    } catch { return []; }
    if (!dados.length) return [];

    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

async function resolver(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    return (await resolverTodos(tipo, tmdbId, temporada, episodio, opcoes))[0] || null;
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverTodos, resolverEpisodio, extrairPlaylist, extrairFontes, limparEndereco, BASE };
