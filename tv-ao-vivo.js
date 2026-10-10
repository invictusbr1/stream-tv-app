'use strict';
// TV ao vivo no Conecta TV.
//
// Usa as listas públicas do projeto iptv-org (grátis, sem anúncio) que o
// caçador da central aprovou com nota acima de 8: Brasil, canais em português,
// esportes, notícias, América Latina e a lista mundial.

const axios = require('axios');
const midia = require('./midia-proxy');
const listasCompartilhadas = require('./listas-tv');

// Listas do aplicativo + as que o caçador da central aprovou (chegam pelo
// arquivo de fichas publicado, sem precisar mexer no código).
const LISTAS = listasCompartilhadas.comExtras((() => {
    try { return require('./perfis-locais').listasTv(); } catch { return []; }
})());

const VALIDADE = 30 * 60 * 1000;
const cache = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function listaDe(id) {
    return LISTAS.find(l => l.id === id) || LISTAS[0];
}

async function canais(idLista) {
    const lista = listaDe(idLista);
    const guardado = cache.get(lista.id);
    if (guardado && guardado.expira > Date.now()) return guardado.canais;

    const resposta = await axios.get(lista.url, { headers: { 'User-Agent': UA }, timeout: 30000, responseType: 'text', maxContentLength: 16 * 1024 * 1024 });
    const linhas = String(resposta.data || '').split('\n').map(l => l.trim());
    const canais = [];
    for (let i = 0; i < linhas.length; i++) {
        if (!/^#EXTINF/i.test(linhas[i])) continue;
        const endereco = linhas[i + 1];
        if (!endereco || endereco.startsWith('#')) continue;
        if (!/^https:\/\//i.test(endereco)) continue;
        const nome = ((linhas[i].match(/,(.*)$/) || [])[1] || 'Canal').replace(/\s*\[[^\]]*\]/g, '').trim().slice(0, 70);
        const logo = (linhas[i].match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
        const grupo = (linhas[i].match(/group-title="([^"]*)"/i) || [])[1] || '';
        // Libera o servidor de vídeo no encaminhamento do aplicativo (usado
        // quando o provedor não deixa o navegador falar direto com ele).
        try { midia.liberarHost(new URL(endereco).hostname); } catch { /* endereço inválido */ }
        canais.push({ nome, logo: /^https:\/\//i.test(logo) ? logo : '', grupo: grupo.slice(0, 40), url: endereco, lista: lista.id });
    }
    cache.set(lista.id, { canais, expira: Date.now() + VALIDADE });
    return canais;
}

module.exports = { LISTAS, canais, listaDe };
