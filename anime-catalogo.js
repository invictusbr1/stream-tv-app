'use strict';
// Página de ANIMES (07/11/2026, pedido do Marlon: "anime em alta, igual
// filme e série, e inovação"). Os dados de anime vêm do AniList (o maior
// banco de anime, público e sem conta): em alta, temporada, episódio novo,
// calendário, mais amados, estilos e filmes. Cada anime é ligado ao TMDB
// (o que o app usa para abrir e tocar) pelo nome — a ligação fica guardada.
// Os "Dublados em português" vêm da TorBox: o servidor confere, aos poucos e
// em segundo plano, se o episódio 1 tem torrent dublado pronto.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ANILIST = 'https://graphql.anilist.co';
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const IMG = 'https://image.tmdb.org/t/p/';
const VALIDADE_PAGINA = 60 * 60 * 1000;
const VALIDADE_MAPA = 30 * 24 * 60 * 60 * 1000;
const VALIDADE_DUB = 24 * 60 * 60 * 1000;

function pastaDados() { return process.env.DADOS_DIR || path.join(os.homedir(), '.conecta-tv'); }
const arquivoMemoria = () => path.join(pastaDados(), 'anime-pagina.json');

// Memória em disco: ligação AniList → TMDB e o que é dublado.
let memoria = null;
function lerMemoria() {
    if (memoria) return memoria;
    try { memoria = JSON.parse(fs.readFileSync(arquivoMemoria(), 'utf8')); } catch { memoria = null; }
    if (!memoria || typeof memoria !== 'object') memoria = {};
    memoria.mapa = memoria.mapa || {};
    memoria.dublado = memoria.dublado || {};
    return memoria;
}
let gravacao = null;
function gravarMemoria() {
    clearTimeout(gravacao);
    gravacao = setTimeout(() => {
        try { fs.mkdirSync(pastaDados(), { recursive: true }); fs.writeFileSync(arquivoMemoria(), JSON.stringify(lerMemoria())); } catch { /* segue só na memória */ }
    }, 2000);
    if (gravacao.unref) gravacao.unref();
}

async function pedirJson(url, opcoes = {}, ms = 15000) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ms);
    try {
        const r = await fetch(url, { ...opcoes, signal: controle.signal, headers: { Accept: 'application/json', 'User-Agent': 'ConectaTV', ...(opcoes.headers || {}) } });
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; } finally { clearTimeout(relogio); }
}

async function anilist(query, variables = {}) {
    const r = await pedirJson(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }, 20000);
    return r && r.data ? r.data : null;
}

// Temporada do anime (o AniList usa as estações do Japão).
function estacaoAtual(data = new Date()) {
    const mes = data.getUTCMonth() + 1, ano = data.getUTCFullYear();
    const season = mes <= 3 ? 'WINTER' : mes <= 6 ? 'SPRING' : mes <= 9 ? 'SUMMER' : 'FALL';
    const nome = { WINTER: 'Inverno', SPRING: 'Primavera', SUMMER: 'Verão', FALL: 'Outono' }[season];
    return { season, ano, nome: `${nome} ${ano}` };
}

const CAMPOS = 'id format episodes genres averageScore popularity seasonYear startDate{year} title{romaji english} synonyms nextAiringEpisode{episode airingAt}';
const lista = (apelido, filtros) => `${apelido}: Page(perPage: 24) { media(type: ANIME, isAdult: false, ${filtros}) { ${CAMPOS} } }`;

// As fileiras da página, na ordem em que aparecem.
const FILEIRAS = [
    { id: 'emAlta', titulo: '🔥 Em alta agora', subtitulo: 'O que mais está sendo assistido nesta semana', filtros: 'sort: TRENDING_DESC' },
    { id: 'temporada', titulo: '📅 Temporada atual', subtitulo: '', filtros: 'season: $season, seasonYear: $ano, sort: POPULARITY_DESC' },
    { id: 'amados', titulo: '🏆 Os mais amados de todos os tempos', subtitulo: 'Maiores notas — ótimo para quando bate a dúvida', filtros: 'sort: SCORE_DESC, popularity_greater: 80000, format_in: [TV, TV_SHORT, ONA]' },
    { id: 'acao', titulo: '⚔️ Ação e batalhas (shonen)', subtitulo: '', filtros: 'genre: "Action", sort: POPULARITY_DESC, format_in: [TV, ONA]' },
    { id: 'isekai', titulo: '🌀 Isekai: preso em outro mundo', subtitulo: '', filtros: 'tag: "Isekai", sort: POPULARITY_DESC' },
    { id: 'romance', titulo: '💞 Romance', subtitulo: '', filtros: 'genre: "Romance", sort: POPULARITY_DESC, format_in: [TV, ONA]' },
    { id: 'comedia', titulo: '😂 Comédia e coisas leves', subtitulo: '', filtros: 'genre_in: ["Comedy", "Slice of Life"], sort: POPULARITY_DESC, format_in: [TV, ONA]' },
    { id: 'esportes', titulo: '🏀 Esportes', subtitulo: '', filtros: 'genre: "Sports", sort: POPULARITY_DESC' },
    { id: 'terror', titulo: '👻 Terror e suspense', subtitulo: '', filtros: 'genre_in: ["Horror", "Thriller"], sort: POPULARITY_DESC' },
    { id: 'mecha', titulo: '🤖 Mecha e ficção científica', subtitulo: '', filtros: 'genre_in: ["Mecha", "Sci-Fi"], sort: POPULARITY_DESC, format_in: [TV, ONA]' },
    { id: 'filmes', titulo: '🎬 Filmes de anime', subtitulo: 'Ghibli, Makoto Shinkai e filmes das grandes séries', filtros: 'format: MOVIE, sort: POPULARITY_DESC' },
];

// "Jujutsu Kaisen 2nd Season" e "Frieren: Beyond Journey's End" → nomes que o
// TMDB conhece (no TMDB a série é uma só, com várias temporadas).
function nomesParaBusca(m) {
    const nomes = [m.title && m.title.english, m.title && m.title.romaji, ...((m.synonyms || []).slice(0, 2))].filter(Boolean).map(String);
    const saida = [];
    const add = n => { const t = String(n).replace(/\s+/g, ' ').trim(); if (t.length >= 2 && !saida.some(x => x.toLowerCase() === t.toLowerCase())) saida.push(t); };
    for (const n of nomes) {
        add(n);
        const semTemporada = n.replace(/\s*[-:]?\s*(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|part\s*\d+|cour\s*\d+|final season.*|the final.*|(?:season|part)\s+[ivx]+)\b.*$/i, '').replace(/\s+\d+$/, '');
        add(semTemporada);
        const antesDoDoisPontos = semTemporada.split(/:\s/)[0];
        if (antesDoDoisPontos.length >= 4) add(antesDoDoisPontos);
    }
    return saida.slice(0, 5);
}

function cartaoDoTmdb(r, tipo) {
    const data = String(r.first_air_date || r.release_date || '');
    return {
        id: String(r.id), tipo, anime: true,
        titulo: String(r.name || r.title || '').slice(0, 200),
        capa: r.poster_path ? IMG + 'w342' + r.poster_path : '',
        fundo: r.backdrop_path ? IMG + 'w1280' + r.backdrop_path : '',
        ano: data.slice(0, 4),
        nota: Number(r.vote_average) ? Math.round(Number(r.vote_average) * 10) / 10 : null,
        sinopse: String(r.overview || '').slice(0, 320),
    };
}

// AniList → TMDB (guardado 30 dias; "não achou" vale 3 dias).
async function paraTmdb(m) {
    const mem = lerMemoria();
    const chave = String(m.id);
    const guardado = mem.mapa[chave];
    if (guardado && guardado.em && Date.now() - guardado.em < (guardado.cartao ? VALIDADE_MAPA : 3 * 24 * 60 * 60 * 1000)) return guardado.cartao || null;
    const tipo = m.format === 'MOVIE' ? 'movie' : 'tv';
    const ano = Number((m.startDate && m.startDate.year) || m.seasonYear) || 0;
    let achado = null;
    for (const nome of nomesParaBusca(m)) {
        const r = await pedirJson(`${TMDB}/search/${tipo}?api_key=${TMDB_KEY}&language=pt-BR&include_adult=false&query=${encodeURIComponent(nome)}`, {}, 10000);
        const resultados = (r && Array.isArray(r.results) ? r.results : []).filter(x => x && x.original_language === 'ja' && Array.isArray(x.genre_ids) && x.genre_ids.includes(16));
        if (!resultados.length) continue;
        // Filme: o do mesmo ano primeiro. Série: a mais popular (a série-mãe).
        resultados.sort((a, b) => {
            if (tipo === 'movie' && ano) {
                const da = Math.abs(Number(String(a.release_date || '').slice(0, 4)) - ano), db = Math.abs(Number(String(b.release_date || '').slice(0, 4)) - ano);
                if (da !== db) return da - db;
            }
            return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
        });
        achado = cartaoDoTmdb(resultados[0], tipo);
        break;
    }
    mem.mapa[chave] = { em: Date.now(), cartao: achado };
    gravarMemoria();
    return achado;
}

async function emLotes(itens, n, fn) {
    const saida = new Array(itens.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
        while (i < itens.length) { const k = i++; saida[k] = await fn(itens[k], k).catch(() => null); }
    }));
    return saida;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function diaEHora(segundos) {
    const d = new Date(segundos * 1000);
    const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const hora = `${(partes.find(p => p.type === 'hour') || {}).value || '00'}:${(partes.find(p => p.type === 'minute') || {}).value || '00'}`;
    const dataSP = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return { dia: DIAS[dataSP.getDay()], hora, indiceDia: dataSP.getDay() };
}

// Clima para o "Me surpreenda": a partir dos gêneros do AniList.
function climas(m) {
    const g = new Set(m.genres || []);
    const c = [];
    if (g.has('Comedy') || g.has('Slice of Life')) c.push('leve');
    if (g.has('Action') || g.has('Adventure')) c.push('acao');
    if (g.has('Drama') || g.has('Psychological')) c.push('chorar');
    if (g.has('Romance')) c.push('romance');
    if (Number(m.episodes) > 0 && Number(m.episodes) <= 13) c.push('curto');
    return c;
}

async function montar() {
    const est = estacaoAtual();
    const query = `query($season: MediaSeason, $ano: Int, $de: Int, $ate: Int) {
        ${FILEIRAS.map(f => lista(f.id, f.filtros)).join('\n')}
        agenda: Page(perPage: 50) { airingSchedules(airingAt_greater: $de, airingAt_lesser: $ate, sort: TIME) { episode airingAt media { ${CAMPOS} isAdult countryOfOrigin } } }
    }`;
    const agora = Math.floor(Date.now() / 1000);
    const dados = await anilist(query, { season: est.season, ano: est.ano, de: agora - 24 * 3600, ate: agora + 6 * 24 * 3600 });
    if (!dados) return null;
    // Liga tudo ao TMDB (6 de cada vez; o que já foi ligado vem da memória).
    const todos = new Map();
    for (const f of FILEIRAS) for (const m of (dados[f.id] && dados[f.id].media) || []) todos.set(m.id, m);
    const agenda = ((dados.agenda && dados.agenda.airingSchedules) || []).filter(a => a && a.media && !a.media.isAdult && a.media.countryOfOrigin === 'JP');
    for (const a of agenda) todos.set(a.media.id, a.media);
    const ids = [...todos.keys()];
    const cartoes = new Map();
    await emLotes(ids, 6, async id => { const c = await paraTmdb(todos.get(id)); if (c) cartoes.set(id, c); });

    const comExtras = m => {
        const c = cartoes.get(m.id);
        if (!c) return null;
        const extra = { ...c, climas: climas(m), episodios: Number(m.episodes) || 0, notaAnilist: Number(m.averageScore) || 0 };
        if (m.nextAiringEpisode && m.nextAiringEpisode.airingAt) { const q = diaEHora(m.nextAiringEpisode.airingAt); extra.proximo = { episodio: m.nextAiringEpisode.episode, dia: q.dia, hora: q.hora }; }
        return extra;
    };
    const unicos = arr => { const vistos = new Set(); return arr.filter(c => c && !vistos.has(c.tipo + c.id) && vistos.add(c.tipo + c.id)); };
    const fileiras = FILEIRAS.map(f => ({
        id: f.id,
        titulo: f.id === 'temporada' ? `📅 Temporada atual · ${est.nome}` : f.titulo,
        subtitulo: f.id === 'temporada' ? 'Lançando episódios agora' : f.subtitulo,
        itens: unicos(((dados[f.id] && dados[f.id].media) || []).map(comExtras)),
    })).filter(f => f.itens.length);

    // Episódio novo hoje (últimas 24 h) e calendário da semana.
    const novos = unicos(agenda.filter(a => a.airingAt <= agora).sort((a, b) => b.airingAt - a.airingAt)
        .map(a => { const c = comExtras(a.media); return c ? { ...c, selo: `Ep. ${a.episode} novo` } : null; }));
    if (novos.length) fileiras.splice(1, 0, { id: 'novos', titulo: '🆕 Episódio novo hoje', subtitulo: 'Saíram nas últimas 24 horas', itens: novos });
    const calendario = {};
    for (const a of agenda.filter(x => x.airingAt > agora)) {
        const c = comExtras(a.media);
        if (!c) continue;
        const q = diaEHora(a.airingAt);
        (calendario[q.dia] = calendario[q.dia] || []).push({ ...c, selo: `Ep. ${a.episode} · ${q.hora}` });
    }
    const emAlta = fileiras.find(f => f.id === 'emAlta');
    const destaque = emAlta && emAlta.itens.find(c => c.fundo) || null;
    // Sorteio do "Me surpreenda": os bem avaliados de todas as fileiras.
    const sorteio = unicos(fileiras.flatMap(f => f.itens)).filter(c => (c.notaAnilist || 0) >= 70 || (c.nota || 0) >= 7.5);
    return { montadaEm: new Date().toISOString(), temporada: est.nome, destaque, fileiras, calendario, ordemDias: diasDaSemanaAPartirDeHoje(), sorteio };
}

function diasDaSemanaAPartirDeHoje() {
    const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
    return Array.from({ length: 7 }, (_, i) => DIAS[(hoje + i) % 7]);
}

// "Dublados em português": confere aos poucos, em segundo plano, se a TorBox
// tem o episódio 1 (ou o filme) dublado pronto. Guardado por 24 h.
let conferindoDub = false;
async function conferirDublados(cartoes) {
    if (conferindoDub) return;
    let tb;
    try { tb = require('./torbox-source'); if (!tb.ativa()) return; } catch { return; }
    conferindoDub = true;
    try {
        const mem = lerMemoria();
        const pendentes = cartoes.filter(c => { const d = mem.dublado[c.tipo + ':' + c.id]; return !d || Date.now() - d.em > VALIDADE_DUB; }).slice(0, 40);
        for (const c of pendentes) {
            const pre = await tb.preludio(c.tipo, c.id, c.tipo === 'tv' ? 1 : undefined, c.tipo === 'tv' ? 1 : undefined, { hevcOk: true }).catch(() => null);
            mem.dublado[c.tipo + ':' + c.id] = { em: Date.now(), sim: Boolean(pre && pre.qualidades && pre.qualidades.length) };
            gravarMemoria();
            await new Promise(ok => setTimeout(ok, 1500));
        }
    } finally { conferindoDub = false; }
}

function aplicarDublados(p) {
    const mem = lerMemoria();
    const ehDub = c => Boolean((mem.dublado[c.tipo + ':' + c.id] || {}).sim);
    const marcar = c => (ehDub(c) ? { ...c, dublado: true } : c);
    const fileiras = p.fileiras.map(f => ({ ...f, itens: f.itens.map(marcar) }));
    const vistos = new Set();
    const dublados = fileiras.flatMap(f => f.itens).filter(c => c.dublado && !vistos.has(c.tipo + c.id) && vistos.add(c.tipo + c.id)).slice(0, 30);
    if (dublados.length) {
        const pos = fileiras.findIndex(f => f.id === 'amados');
        fileiras.splice(pos < 0 ? fileiras.length : pos, 0, { id: 'dublados', titulo: '🇧🇷 Dublados em português', subtitulo: 'Com versão dublada pronta para tocar', itens: dublados });
    }
    const calendario = Object.fromEntries(Object.entries(p.calendario || {}).map(([d, l]) => [d, l.map(marcar)]));
    return { ...p, destaque: p.destaque ? marcar(p.destaque) : null, fileiras, calendario, sorteio: (p.sorteio || []).map(marcar) };
}

let montando = null, pagina = null, paginaEm = 0;
async function obterPagina() {
    if (!pagina || Date.now() - paginaEm > VALIDADE_PAGINA) {
        if (!montando) montando = montar().then(p => { if (p) { pagina = p; paginaEm = Date.now(); } return p; }).catch(() => null).finally(() => { montando = null; });
        // Sem página guardada, espera montar; com uma antiga, entrega ela e atualiza por trás.
        if (!pagina) await montando;
    }
    if (!pagina) return null;
    const tvs = pagina.fileiras.flatMap(f => f.itens).filter((c, i, a) => a.findIndex(x => x.tipo === c.tipo && x.id === c.id) === i);
    conferirDublados(tvs).catch(() => {});
    return aplicarDublados(pagina);
}

// "Porque você assistiu X": recomendações do TMDB, só anime.
const recomendacoes = new Map();
async function recomendar(tipo, id) {
    const t = tipo === 'movie' ? 'movie' : 'tv';
    if (!/^\d{1,10}$/.test(String(id))) return [];
    const chave = t + ':' + id, guardado = recomendacoes.get(chave);
    if (guardado && Date.now() - guardado.em < 6 * 60 * 60 * 1000) return guardado.itens;
    const r = await pedirJson(`${TMDB}/${t}/${id}/recommendations?api_key=${TMDB_KEY}&language=pt-BR`, {}, 10000);
    const itens = (r && Array.isArray(r.results) ? r.results : []).filter(x => x && x.original_language === 'ja' && Array.isArray(x.genre_ids) && x.genre_ids.includes(16)).slice(0, 20).map(x => cartaoDoTmdb(x, x.media_type === 'movie' ? 'movie' : t));
    recomendacoes.set(chave, { em: Date.now(), itens });
    if (recomendacoes.size > 300) recomendacoes.delete(recomendacoes.keys().next().value);
    return itens;
}

module.exports = { obterPagina, recomendar, estacaoAtual, nomesParaBusca, climas, cartaoDoTmdb, aplicarDublados, FILEIRAS, _montar: montar, _memoria: () => lerMemoria() };
