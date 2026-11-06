'use strict';
// TorBox (debrid) como fonte dublada do Conecta TV.
//
// Caminho: TMDB → IMDb → Torrentio (lista pública de torrents, só os com
// áudio em português declarado) → TorBox diz quais já estão no cache dela →
// para o melhor de cada qualidade a TorBox entrega um link HTTPS do arquivo.
// Nada é semeado: a TorBox já tem o arquivo e só entrega por download comum.
//
// Medido em 05/11/2026 (Pro, teste): 12 de 13 títulos dublados no cache,
// link pronto em ~1 s, 18–138 Mbit/s, avanço livre. Os arquivos costumam ser
// MKV com som Dolby (EAC3): o navegador do celular fica mudo, então esses
// vão pelo conversor (vídeo copiado, só o áudio vira AAC). MP4 vai direto.
//
// Por enquanto só Full HD/HD em H.264: 4K é quase sempre H.265 10 bits
// (muitos celulares não mostram imagem) e 20+ GB passando pela Oracle.
//
// A chave NUNCA sai do servidor: vem de TORBOX_API_KEY (Oracle, arquivo .env)
// ou de CHAVE-TORBOX.local.txt (PC). O link do arquivo também leva a chave
// (token=), então ele fica no cofre do servidor (cofre-links.cjs) e o
// aparelho recebe só /api/torbox/<código aleatório> ou a conversão.

const fs = require('node:fs');
const path = require('node:path');

const API = 'https://api.torbox.app/v1/api';
// Listas públicas de torrents (nenhuma recebe a chave). Conferido em
// 05/11/2026 pelo botão "Conferir addons": o Torrentio padrão (todos os
// provedores) e o Absolute Cinema trazem dublados que a lista filtrada não
// tinha — foi assim que o Curvas da Vida apareceu pronto na TorBox.
const LISTAS = [
    'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,bludv|language=portuguese|qualityfilter=scr,cam,4k',
    'https://torrentio.strem.fun',
    'https://cinema.debrid.in',
];
const VALIDADE = 2 * 60 * 60 * 1000;      // link e resultado por título
const VALIDADE_VAZIO = 20 * 60 * 1000;    // "não tem" é revisto em 20 min
const GUARDAR_NA_CONTA = 48 * 60 * 60 * 1000;
const VIDEO = /\.(mkv|mp4|m4v|avi|ts|webm)$/i;
const AMOSTRA = /\bsample\b|\btrailer\b/i;

const cache = new Map();
const emAndamento = new Map();
let ultimaLimpeza = 0;

function lerChave() {
    // Nos testes automáticos a fonte fica desligada (não gasta a conta).
    if (process.env.NODE_TEST_CONTEXT && process.env.CONECTA_TORBOX_TESTE !== '1') return '';
    const doAmbiente = String(process.env.TORBOX_API_KEY || '').trim();
    if (/^[A-Za-z0-9-]{20,80}$/.test(doAmbiente)) return doAmbiente;
    try {
        const texto = fs.readFileSync(path.join(__dirname, 'CHAVE-TORBOX.local.txt'), 'utf8');
        const linha = texto.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
        return /^[A-Za-z0-9-]{20,80}$/.test(linha) ? linha : '';
    } catch { return ''; }
}
const ativa = () => Boolean(lerChave());

// O Torrentio marca português com 🇵🇹 (não usa 🇧🇷). Conferido em 06/11/2026:
// "DUAL" sozinho pegava lançamento latino (Curvas da Vida "Dual-Lat", 🇲🇽) e
// indiano (Os Suspeitos "Dual Audio [Hindi + English]", 🇮🇳).
const PT_PALAVRA = /🇧🇷|dublad|nacional|pt[-. ]?br|portugu/i;
// No Torrentio, 4+ bandeiras separadas por "/" sem Dual/Multi são legendas de
// lançamento em inglês (ex.: AMZN playWEB "🇬🇧 / 🇵🇹 / 🇪🇸 / 🇫🇷 / 🇳🇱"), não dublagem.
const LEGENDAS_MULTI = /(?:[\u{1F1E6}-\u{1F1FF}]{2}\s*\/\s*){3,}[\u{1F1E6}-\u{1F1FF}]{2}/u;
const OUTRO_IDIOMA = /🇲🇽|🇪🇸|🇦🇷|🇨🇴|🇮🇳|🇷🇺|🇫🇷|🇮🇹|🇩🇪|🇰🇷|🇯🇵|🇨🇳|🇹🇷|\b(?:lat(?:ino|am)?|castellano|castilian|espa[nñ]ol|spanish|hindi|tamil|telugu|malayalam|russian|french|italian|german|korean|turkish)\b/i;
function dubladoExplicito(rotulo) {
    const t = String(rotulo || '');
    if (PT_PALAVRA.test(t)) return true;
    return /🇵🇹/.test(t) && (/\b(?:dual|multi)\b/i.test(t) || !LEGENDAS_MULTI.test(t));
}
function ehPortugues(rotulo) {
    const t = String(rotulo || '');
    if (dubladoExplicito(t)) return true;
    // "DUAL" sem dizer o idioma só vale se nada indicar outra língua.
    return /\bdual\b/i.test(t) && !OUTRO_IDIOMA.test(t);
}
function qualidade(rotulo) {
    const t = String(rotulo || '');
    if (/2160p|\b4k\b|uhd/i.test(t)) return '4K';
    const m = t.match(/\b(1080|720|480)p\b/i);
    return m ? m[1] + 'p' : '';
}
function hashDe(s) {
    if (s && /^[a-f0-9]{40}$/i.test(s.infoHash || '')) return s.infoHash.toLowerCase();
    const m = String((s && s.url) || '').match(/btih:([a-f0-9]{40})/i);
    return m ? m[1].toLowerCase() : '';
}
const rotuloDe = s => `${s.name || ''} ${s.title || ''} ${s.description || ''} ${(s.behaviorHints || {}).filename || ''}`;
// Junta as listas sem repetir torrent (fica a primeira ocorrência).
function juntar(listas) {
    const vistos = new Set(), saida = [];
    for (const lista of listas) for (const s of lista || []) {
        const h = hashDe(s);
        if (!h || vistos.has(h)) continue;
        vistos.add(h); saida.push({ ...s, infoHash: h });
    }
    return saida;
}
const ehHevc = rotulo => /x265|hevc|h\.?265|10.?bit/i.test(String(rotulo || ''));
function tamanhoGB(rotulo) {
    const m = String(rotulo || '').match(/💾\s*([\d.,]+)\s*([GM]B)/i);
    if (!m) return 0;
    const n = Number(m[1].replace(',', '.')) || 0;
    return /^M/i.test(m[2]) ? n / 1024 : n;
}

// Melhor torrent de cada qualidade (Full HD primeiro, depois HD), só H.264.
// Quem diz português com todas as letras (ou 🇵🇹) vem antes do "DUAL" genérico;
// entre iguais, o maior arquivo (menos comprimido) ganha.
function escolherTorrents(streams, emCache) {
    const pt = (streams || []).filter(s => s && hashDe(s) && emCache.has(hashDe(s)) && ehPortugues(rotuloDe(s)) && !/\b(?:cam|ts|hdcam|telesync)\b/i.test(rotuloDe(s)));
    const escolhidos = [];
    for (const q of ['1080p', '720p']) {
        const daQualidade = pt.filter(s => qualidade(rotuloDe(s)) === q && !ehHevc(rotuloDe(s)))
            .sort((a, b) => (dubladoExplicito(rotuloDe(b)) - dubladoExplicito(rotuloDe(a))) || (tamanhoGB(rotuloDe(b)) - tamanhoGB(rotuloDe(a))));
        if (daQualidade[0]) escolhidos.push({ stream: daQualidade[0], qualidade: q });
    }
    return escolhidos;
}

// Arquivo certo dentro do torrent (pacote de temporada tem vários).
function escolherArquivo(arquivos, { nome = '', temporada = 0, episodio = 0 } = {}) {
    const videos = (arquivos || []).filter(a => VIDEO.test(a.name || a.short_name || '') && !AMOSTRA.test(a.short_name || a.name || ''));
    const curto = a => String(a.short_name || a.name || '').toLowerCase();
    if (nome) {
        const alvo = String(nome).toLowerCase();
        const achado = videos.find(a => curto(a) === alvo || String(a.name || '').toLowerCase().endsWith(alvo));
        if (achado) return achado;
    }
    if (temporada && episodio) {
        const s = Number(temporada), e = Number(episodio);
        const padrao = new RegExp(`(?:s0*${s}[ ._-]*e0*${e}(?!\\d))|(?:\\b0*${s}x0*${e}(?!\\d))`, 'i');
        const achado = videos.find(a => padrao.test(curto(a)));
        if (achado) return achado;
        if (videos.length > 1) return null; // pacote sem o episódio: melhor nada que o errado
    }
    return videos.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0] || null;
}

async function pedir(url, opcoes = {}, ms = 8000) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ms);
    try {
        const r = await fetch(url, { ...opcoes, signal: controle.signal, headers: { 'User-Agent': 'ConectaTV', Accept: 'application/json', ...(opcoes.headers || {}) } });
        let json = null; try { json = JSON.parse(await r.text()); } catch { /* não é JSON */ }
        return { status: r.status, json };
    } catch { return { status: 0, json: null }; }
    finally { clearTimeout(relogio); }
}

async function emCacheNaTorBox(chave, hashes) {
    const achados = new Set();
    if (!hashes.length) return achados;
    const r = await pedir(`${API}/torrents/checkcached?hash=${hashes.slice(0, 100).join(',')}&format=object`, { headers: { Authorization: `Bearer ${chave}` } });
    const dados = r.json && r.json.data;
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) for (const h of Object.keys(dados)) achados.add(h.toLowerCase());
    else if (Array.isArray(dados)) for (const d of dados) if (d && d.hash) achados.add(String(d.hash).toLowerCase());
    return achados;
}

async function minhaLista(chave) {
    const r = await pedir(`${API}/torrents/mylist?bypass_cache=true`, { headers: { Authorization: `Bearer ${chave}` } });
    return Array.isArray(r.json && r.json.data) ? r.json.data : [];
}

// Apaga da conta o que foi aberto há mais de 2 dias (no máximo a cada 6 h).
async function limparConta(chave, lista) {
    if (Date.now() - ultimaLimpeza < 6 * 60 * 60 * 1000) return;
    ultimaLimpeza = Date.now();
    for (const t of lista) {
        const criado = Date.parse(t.created_at || '') || 0;
        if (!criado || Date.now() - criado < GUARDAR_NA_CONTA) continue;
        await pedir(`${API}/torrents/controltorrent`, { method: 'POST', headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: t.id, operation: 'delete' }) });
    }
}

async function torrentNaConta(chave, hash, lista) {
    const ja = lista.find(t => String(t.hash || '').toLowerCase() === hash);
    if (ja && Array.isArray(ja.files) && ja.files.length) return ja;
    const form = new FormData();
    form.append('magnet', `magnet:?xt=urn:btih:${hash}`);
    const criado = await pedir(`${API}/torrents/createtorrent`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${chave}` } }, 10000);
    const id = (criado.json && criado.json.data && criado.json.data.torrent_id) || (ja && ja.id);
    if (!id) return null;
    for (let i = 0; i < 4; i++) {
        const r = await pedir(`${API}/torrents/mylist?id=${id}&bypass_cache=true`, { headers: { Authorization: `Bearer ${chave}` } });
        const t = r.json && r.json.data;
        if (t && Array.isArray(t.files) && t.files.length) return t;
        await new Promise(ok => setTimeout(ok, 700));
    }
    return null;
}

async function linkDoArquivo(chave, torrentId, arquivoId) {
    const r = await pedir(`${API}/torrents/requestdl?token=${encodeURIComponent(chave)}&torrent_id=${torrentId}&file_id=${arquivoId}&redirect=false`, { headers: { Authorization: `Bearer ${chave}` } }, 10000);
    const link = r.json && r.json.data;
    if (typeof link !== 'string' || !/^https:\/\//.test(link)) return { url: '', motivo: `requestdl sem link (HTTP ${r.status}${r.json && r.json.detail ? ': ' + String(r.json.detail).slice(0, 80) : ''})` };
    return { url: link, motivo: '' };
}

async function buscar(chave, tipo, tmdbId, temporada, episodio, rastro = []) {
    const ehSerie = tipo === 'tv';
    const imdb = await require('./fenix-source').imdbDe(tmdbId, ehSerie ? 'tv' : 'movie');
    if (!imdb) { rastro.push('sem código IMDb no TMDB'); return []; }
    const caminho = ehSerie ? `series/${imdb}:${temporada || 1}:${episodio || 1}` : `movie/${imdb}`;
    const respostas = await Promise.all(LISTAS.map(base => pedir(`${base}/stream/${caminho}.json`, {}, 6000)));
    const streams = juntar(respostas.map(r => (r.json && Array.isArray(r.json.streams) ? r.json.streams : [])));
    const hashes = streams.filter(s => ehPortugues(rotuloDe(s))).map(hashDe);
    const emCache = await emCacheNaTorBox(chave, hashes);
    const escolhidos = escolherTorrents(streams, emCache);
    rastro.push(`${imdb}: listas ${respostas.map(r => r.status + '/' + ((r.json && r.json.streams) || []).length).join(' ')} · ${streams.length} torrents · ${hashes.length} PT · ${emCache.size} prontos · escolhidos ${escolhidos.map(e => e.qualidade).join('+') || 'nenhum'}`);
    if (!escolhidos.length) return [];
    const lista = await minhaLista(chave);
    limparConta(chave, lista).catch(() => {});
    const saida = await Promise.all(escolhidos.map(async ({ stream, qualidade: q }) => {
        const torrent = await torrentNaConta(chave, hashDe(stream), lista);
        if (!torrent) { rastro.push(`${q}: TorBox não aceitou o torrent`); return null; }
        const arquivo = escolherArquivo(torrent.files, { nome: (stream.behaviorHints || {}).filename, temporada: ehSerie ? temporada : 0, episodio: ehSerie ? episodio : 0 });
        if (!arquivo) { rastro.push(`${q}: arquivo do vídeo não encontrado (${(torrent.files || []).length} arquivos)`); return null; }
        const { url, motivo } = await linkDoArquivo(chave, torrent.id, arquivo.id);
        if (!url) { rastro.push(`${q}: ${motivo}`); return null; }
        rastro.push(`${q}: link ok (${String(arquivo.short_name || arquivo.name || '').slice(-60)})`);
        const mp4 = /\.(mp4|m4v)$/i.test(arquivo.short_name || arquivo.name || '');
        return {
            url,
            audio: 'pt-BR',
            fonte: `TorBox · dublado ${q}${mp4 ? '' : ' (conversão)'}`,
            resolucao: q,
            type: mp4 ? 'file' : 'convertido',
            // O link traz a chave da conta: nunca vai ao aparelho. MP4 passa
            // pelo repasse /api/torbox/<código>; MKV pelo conversor.
            final: false,
            segredo: true,
            converter: !mp4,
            efemera: true,
            // "DUAL" sozinho também aparece em lançamento espanhol: só conta
            // como dublado confiável quando o rótulo diz português/Brasil.
            dubladoConfiavel: dubladoExplicito(rotuloDe(stream)),
            videoCodec: 'h264',
            validadeMs: VALIDADE,
        };
    }));
    return saida.filter(Boolean);
}

async function resolverTodos(tipo, tmdbId, temporada, episodio, rastro = null) {
    const chave = lerChave();
    const id = String(tmdbId || '').trim();
    if (!chave || !/^\d{1,10}$/.test(id) || (tipo !== 'movie' && tipo !== 'tv')) return [];
    const marca = tipo === 'tv' ? `tv:${id}:${temporada || 1}:${episodio || 1}` : `movie:${id}`;
    const guardado = cache.get(marca);
    if (guardado && guardado.expira > Date.now()) return guardado.valor.map(d => ({ ...d }));
    // A segunda rodada do avaliador reaproveita o pedido que já está em curso
    // (sem criar outro torrent na conta).
    if (emAndamento.has(marca)) return (await emAndamento.get(marca)).map(d => ({ ...d }));
    if (rastro) return buscar(chave, tipo, id, temporada, episodio, rastro).catch(e => { rastro.push('erro: ' + e.message); return []; });
    const trabalho = buscar(chave, tipo, id, temporada, episodio).catch(() => []);
    emAndamento.set(marca, trabalho);
    try {
        const valor = await trabalho;
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        cache.set(marca, { valor, expira: Date.now() + (valor.length ? VALIDADE - 10 * 60 * 1000 : VALIDADE_VAZIO) });
        return valor.map(d => ({ ...d }));
    } finally { emAndamento.delete(marca); }
}

async function resolver(tipo, tmdbId, temporada, episodio) {
    return (await resolverTodos(tipo, tmdbId, temporada, episodio))[0] || null;
}

module.exports = { resolver, resolverTodos, ativa, lerChave, ehPortugues, dubladoExplicito, qualidade, ehHevc, escolherTorrents, escolherArquivo, tamanhoGB, hashDe, juntar };
