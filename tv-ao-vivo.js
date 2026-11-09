'use strict';
// TV ao vivo no Conecta TV.
//
// Usa as listas públicas do projeto iptv-org (grátis, sem anúncio) que o
// caçador da central aprovou com nota acima de 8: Brasil, canais em português,
// esportes, notícias, América Latina e a lista mundial.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const midia = require('./midia-proxy');
const listasCompartilhadas = require('./listas-tv');

// Listas do aplicativo + as que o caçador da central aprovou (chegam pelo
// arquivo de fichas publicado, sem precisar mexer no código).
function listarTodas() {
    try {
        return listasCompartilhadas.comExtras(require('./perfis-locais').listasTv());
    } catch {
        return listasCompartilhadas.LISTAS;
    }
}
const LISTAS = listarTodas();

const VALIDADE = 30 * 60 * 1000;
const cache = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function listaDe(id) {
    const todas = listarTodas();
    return todas.find(l => l.id === id) || todas[0];
}

function lerM3uVerificadosLocal() {
    for (const p of [
        path.join(__dirname, 'central', 'dados-pc', 'tv-cacador-verificados.m3u'),
        path.join(__dirname, 'central', 'dados', 'tv-cacador-verificados.m3u'),
    ]) {
        try {
            if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
        } catch { /* ignora */ }
    }
    return '';
}

async function canais(idLista) {
    const lista = listaDe(idLista);
    const guardado = cache.get(lista.id);
    if (guardado && guardado.expira > Date.now()) return guardado.canais;

    let m3uTexto = '';
    try {
        const resposta = await axios.get(lista.url, { headers: { 'User-Agent': UA }, timeout: 30000, responseType: 'text', maxContentLength: 16 * 1024 * 1024 });
        m3uTexto = resposta.data;
    } catch (erro) {
        if (lista.id === 'cacador-verificados') {
            m3uTexto = lerM3uVerificadosLocal();
        }
        if (!m3uTexto) throw erro;
    }
    const canais = listasCompartilhadas.parseM3u(m3uTexto, lista.id, { doCacador: Boolean(lista.doCacador), setor: lista.setor || '' });
    for (const canal of canais) midia.liberarHost(new URL(canal.url).hostname);
    cache.set(lista.id, { canais, expira: Date.now() + VALIDADE });
    return canais;
}

async function canaisDoSetor(setor = 'todos') {
    const ids = listasCompartilhadas.listasDoSetor(setor, listarTodas());
    const resultados = await Promise.all(ids.map(id => canais(id).catch(() => [])));
    const juntos = [];
    const vistos = new Set();
    for (let i = 0; i < resultados.length; i++) {
        for (const c of resultados[i] || []) {
            if (!c || !c.url || vistos.has(c.url)) continue;
            vistos.add(c.url);
            juntos.push(c);
        }
    }
    return setor && setor !== 'todos'
        ? juntos.filter(c => listasCompartilhadas.pertenceAoSetor(c, setor))
        : juntos;
}

module.exports = { LISTAS, listarTodas, canais, canaisDoSetor, listaDe };
