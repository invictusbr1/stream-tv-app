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
    const canais = listasCompartilhadas.parseM3u(resposta.data, lista.id);
    for (const canal of canais) midia.liberarHost(new URL(canal.url).hostname);
    cache.set(lista.id, { canais, expira: Date.now() + VALIDADE });
    return canais;
}

module.exports = { LISTAS, canais, listaDe };
