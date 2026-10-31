'use strict';
// Fonte dublada do addon público "TH Soluções" (addon.thsolucoes.site), um
// dos addons Stremio que o Kairou usa por trás.
//
// Conferido em 31/10/2026 (Batman: O Cavaleiro das Trevas e Game of Thrones
// 1x1), com o vídeo tocando no navegador e o áudio transcrito (Whisper):
//   - server-1/play-1.cnvods.com  → MP4 1282x534, áudio em PORTUGUÊS
//     ("Já que é o novo promotor, devia se informar onde sua jurisdição termina")
//   - play.vodshuby.com           → MP4 1280x545, áudio em PORTUGUÊS (filme e série)
// Nenhuma rede de anúncio, pop-up ou página no caminho: o addon devolve o
// endereço do arquivo e o arquivo vai direto ao player.
//
// Só entram os servidores com dublado COMPROVADO (lista abaixo). Os outros que
// o addon também lista (wasabisys, radiogaucha) ainda não tiveram o áudio
// ouvido — ficam de fora até o caçador confirmar.
// O vodshuby redireciona para um servidor em http://; por isso fica por
// último (no link público em https o navegador pode recusar).

const axios = require('axios');

const BASE = 'https://addon.thsolucoes.site';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const VALIDADE = 10 * 60 * 1000; // os endereços levam token com validade

// Servidores com áudio em português conferido. Ordem = preferência.
const SERVIDORES_CONFERIDOS = [
    { padrao: /(^|\.)cnvods\.com$/i, peso: 3 },
    { padrao: /(^|\.)vodis01\.com$/i, peso: 3 }, // mesma família "CS" das séries
    { padrao: /(^|\.)vodshuby\.com$/i, peso: 1 },
];

const cache = new Map();
const cacheImdb = new Map();

function numero(valor) { const n = Number(valor); return Number.isFinite(n) && n > 0 ? n : 0; }

function pesoDoServidor(url) {
    let host = '';
    try { host = new URL(url).hostname; } catch { return 0; }
    const achado = SERVIDORES_CONFERIDOS.find(s => s.padrao.test(host));
    return achado ? achado.peso : 0;
}

// Recebe os streams do addon e fica só com os dublados de servidor conferido.
// Função pura para os testes; a rede fica em resolverTodos.
function escolherStreams(streams) {
    const vistos = new Set();
    const lista = [];
    for (const bruto of Array.isArray(streams) ? streams : []) {
        const url = String(bruto && bruto.url || '');
        const rotulo = `${bruto && bruto.name || ''} ${bruto && bruto.title || ''}`;
        if (!/^https:\/\//i.test(url) || vistos.has(url)) continue;
        if (!/dublad|🇧🇷/i.test(rotulo) || /legendad/i.test(rotulo)) continue;
        if (/\.m3u8(\?|$)|youtu\.?be/i.test(url)) continue;
        const peso = pesoDoServidor(url);
        if (!peso) continue;
        vistos.add(url);
        lista.push({ url, peso, nome: String(bruto.name || 'TH Soluções').replace(/\s+/g, ' ').trim() });
    }
    return lista.sort((a, b) => b.peso - a.peso);
}

async function imdbDe(tmdbId, tipo) {
    const chave = `${tipo}:${tmdbId}`;
    const guardado = cacheImdb.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;
    try {
        const caminho = tipo === 'tv' ? 'tv' : 'movie';
        const r = await axios.get(`https://api.themoviedb.org/3/${caminho}/${tmdbId}/external_ids`, {
            params: { api_key: TMDB_KEY }, timeout: 10000,
        });
        const imdb = String(r.data && r.data.imdb_id || '');
        if (!/^tt\d{5,10}$/.test(imdb)) return null;
        cacheImdb.set(chave, { valor: imdb, expira: Date.now() + 24 * 60 * 60 * 1000 });
        return imdb;
    } catch { return null; }
}

async function resolverTodos(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return [];
    const serie = tipo === 'tv' || tipo === 'series';
    const s = numero(temporada) || 1;
    const e = numero(episodio) || 1;
    const chave = serie ? `tv:${id}:${s}:${e}` : `movie:${id}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now() && !opcoes.semCache) return guardado.valor;

    const imdb = await imdbDe(id, serie ? 'tv' : 'movie');
    if (!imdb) return [];
    const caminho = serie ? `series/${imdb}:${s}:${e}.json` : `movie/${imdb}.json`;
    let streams = [];
    try {
        const r = await axios.get(`${BASE}/stream/${caminho}`, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            timeout: 8000,
            maxContentLength: 1024 * 1024,
            validateStatus: status => status < 500,
        });
        streams = r.data && Array.isArray(r.data.streams) ? r.data.streams : [];
    } catch { return []; }

    const escolhidos = escolherStreams(streams);
    if (!escolhidos.length) return [];
    const dados = escolhidos.map(item => ({
        url: item.url,
        audio: 'pt-BR',
        fonte: 'TH Soluções · dublado',
        referer: '',
        resolucao: '720p',
        type: 'file',
        final: true,
    }));
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

async function resolver(tipo, tmdbId, temporada, episodio, opcoes = {}) {
    return (await resolverTodos(tipo, tmdbId, temporada, episodio, opcoes))[0] || null;
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverTodos, resolverEpisodio, escolherStreams, BASE, SERVIDORES_CONFERIDOS };
