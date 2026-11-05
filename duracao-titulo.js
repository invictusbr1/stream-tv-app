'use strict';
// Duração oficial do FILME (TMDB, em minutos), para conferir se a fonte
// entregou o filme certo. Alguns fornecedores procuram pelo nome e devolvem
// outro filme com o mesmo título — medido em 04/11/2026: "Os Suspeitos"
// (2013, 153 min) chegava como "Os Suspeitos" (1995, 106 min).
//
// Episódio de série não é conferido (a duração varia muito entre episódios).

const axios = require('axios');

const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const cache = new Map();

async function minutos(alvo) {
    if (process.env.CONECTA_SEM_DURACAO === '1') return 0;
    if (!alvo || alvo.tipo !== 'movie' || !/^\d{1,10}$/.test(String(alvo.tmdbId || ''))) return 0;
    const id = String(alvo.tmdbId);
    const guardado = cache.get(id);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;
    let valor = 0;
    try {
        const r = await axios.get(`https://api.themoviedb.org/3/movie/${id}`, { params: { api_key: TMDB_KEY }, timeout: 2500 });
        valor = Number(r.data && r.data.runtime) || 0;
    } catch { return 0; }
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(id, { valor, expira: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return valor;
}

// true quando a duração medida (segundos) mostra que é OUTRO filme.
// Folga generosa (20 min ou 20%) para versão estendida, créditos e cortes;
// arquivo com menos de 20 min é trailer/aviso, mas isso já é tratado em
// outro lugar e não entra aqui.
function outroTitulo(esperadaMin, medidaSeg) {
    const esperada = Number(esperadaMin) || 0;
    const medida = (Number(medidaSeg) || 0) / 60;
    if (esperada < 40 || medida < 20) return false;
    return Math.abs(medida - esperada) > Math.max(20, esperada * 0.2);
}

module.exports = { minutos, outroTitulo };
