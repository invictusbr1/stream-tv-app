'use strict';
// Caçada por título — o caçador vai atrás de UM título que falhou.
//
// Antes o caçador testava uma amostra fixa em uns poucos addons. Agora:
//   1. lê os CATÁLOGOS PÚBLICOS de addons (centenas de endereços, renovados
//      sozinhos a cada 12 h) além da lista fixa;
//   2. pergunta a TODOS, em paralelo, pelo episódio/filme exato que falhou
//      (ex.: Quem Ama Cuida 1x137);
//   3. mede o vídeo de quem respondeu com rótulo dublado (tem imagem? que
//      altura? o áudio é português?);
//   4. quem passou vira FICHA e é validada em OUTROS títulos (novelas para
//      novela, filmes populares para filme) — só entra no app com duas provas
//      independentes em HD com áudio em português, como sempre.
//
// Nada aqui contorna proteção: é a mesma leitura pública de addons que o
// varredor já fazia, só que em escala e dirigida ao título que falhou.

const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';

// Catálogos públicos de addons (formato do próprio Stremio: {addons:[{transportUrl, manifest}]}).
const CATALOGOS = [
    'https://stremio-addons.net/api/addon_catalog/all/stremio-addons.net.json',
    'https://api.strem.io/addonscollection.json',
];
const VALIDADE_CATALOGO = 12 * 60 * 60 * 1000;

// Respostas que parecem stream mas são aviso, cadastro ou página de erro.
const LIXO = /sign ?in|signin|login|token[- ]required|configure|deprecated|obsolete|auth(entication)? (error|failed)|not (active|available)|status: down|buymeacoffee|example\.com|archive\.org\/download\/bigbuckbunny|comet\.feels\.legal|donat|suspended|disabled|acces blocat|stremio-status/i;
const ADULTO = /adult|hentai|xxx|porn|\+18|18\+|nsfw/i;

function marcasDeDublado(texto) {
    return /dublado|dual[ -]?áudio|dual[ -]?audio|🇧🇷|pt-?br|portugu/i.test(String(texto || ''));
}
function alturaDoRotulo(texto) {
    const s = String(texto || '');
    if (/\b(4k|uhd|2160p?)\b/i.test(s)) return 2160;
    const achado = /\b(1080|720|576|540|480|360)p\b/i.exec(s);
    return achado ? Number(achado[1]) : 0;
}
function baseDoAddon(transportUrl) {
    const url = String(transportUrl || '').trim();
    if (!/^https:\/\//i.test(url)) return '';
    return url.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
}
function idDaFicha(nome, base) {
    const limpo = String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    if (limpo) return limpo;
    try { return new URL(base).hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 32); } catch { return 'addon'; }
}

// Um addon do catálogo só interessa se entrega stream de filme/série, não
// pede configuração e não é adulto/torrent.
function addonUtil(entrada) {
    const manifest = entrada && entrada.manifest || {};
    const base = baseDoAddon(entrada && entrada.transportUrl);
    if (!base) return null;
    const recursos = JSON.stringify(manifest.resources || '');
    const tipos = Array.isArray(manifest.types) ? manifest.types.map(String) : [];
    if (!/stream/.test(recursos)) return null;
    if (!tipos.some(t => t === 'movie' || t === 'series')) return null;
    if (ADULTO.test(`${manifest.name || ''} ${manifest.description || ''} ${base}`)) return null;
    const dica = manifest.behaviorHints || {};
    if (dica.configurationRequired === true) return null;
    if (/torrent|debrid|magnet|usenet|easynews|jackett/i.test(`${manifest.name || ''} ${manifest.id || ''}`)) return null;
    return {
        nome: String(manifest.name || base).slice(0, 60),
        base,
        tipos: tipos.filter(t => t === 'movie' || t === 'series'),
        brasileiro: marcasDeDublado(`${manifest.name || ''} ${manifest.description || ''}`) || /\bbr\b|brasil|brazil|novela/i.test(`${manifest.name || ''} ${manifest.description || ''}`),
    };
}

// Lê os catálogos (com cópia em disco para não baixar a cada rodada).
async function carregarCatalogo({ buscarJson, pastaDados, fixos = [], agora = Date.now(), registrar = () => {} } = {}) {
    const arquivo = pastaDados ? path.join(pastaDados, 'catalogo-addons.json') : '';
    let guardado = null;
    if (arquivo) { try { guardado = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { guardado = null; } }
    let lista = guardado && Array.isArray(guardado.addons) && agora - Number(guardado.em || 0) < VALIDADE_CATALOGO ? guardado.addons : null;
    if (!lista) {
        const vistos = new Map();
        for (const url of CATALOGOS) {
            const dados = await buscarJson(url).catch(() => null);
            const entradas = Array.isArray(dados) ? dados : Array.isArray(dados && dados.addons) ? dados.addons : [];
            let uteis = 0;
            for (const entrada of entradas) {
                const addon = addonUtil(entrada);
                if (addon && !vistos.has(addon.base)) { vistos.set(addon.base, addon); uteis++; }
            }
            registrar(`catálogo ${new URL(url).hostname}: ${entradas.length} addons, ${uteis} úteis`);
        }
        lista = [...vistos.values()];
        if (lista.length && arquivo) {
            try { fs.mkdirSync(pastaDados, { recursive: true }); fs.writeFileSync(arquivo, JSON.stringify({ em: agora, addons: lista }, null, 1)); } catch { /* segue sem cópia */ }
        }
        if (!lista.length && guardado && Array.isArray(guardado.addons)) lista = guardado.addons;
    }
    const todos = new Map();
    for (const addon of [...fixos, ...(lista || [])]) if (addon && addon.base && !todos.has(addon.base)) todos.set(addon.base, { tipos: ['movie', 'series'], ...addon });
    // Brasileiros primeiro: são os que mais têm dublado e novela.
    return [...todos.values()].sort((a, b) => Number(Boolean(b.brasileiro)) - Number(Boolean(a.brasileiro)));
}

function caminhoStremio(alvo) {
    return alvo.tipo === 'tv'
        ? `/stream/series/${alvo.imdb}:${alvo.temporada || 1}:${alvo.episodio || 1}.json`
        : `/stream/movie/${alvo.imdb}.json`;
}

// Só streams utilizáveis pelo app: endereço http(s) direto, rótulo dublado,
// sem aviso/erro disfarçado. Torrent (infoHash) não toca no app.
function streamsUteis(streams) {
    const saida = [];
    for (const s of Array.isArray(streams) ? streams : []) {
        if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) continue;
        const rotulo = `${s.name || ''} ${s.title || ''} ${s.description || ''}`.replace(/\s+/g, ' ');
        if (LIXO.test(rotulo) || LIXO.test(s.url)) continue;
        if (!marcasDeDublado(rotulo) || (/\blegendado\b/i.test(rotulo) && !/\bdual\b/i.test(rotulo))) continue;
        saida.push({ url: s.url.replace(/^http:/i, 'https:'), rotulo: rotulo.slice(0, 140), altura: alturaDoRotulo(rotulo) });
    }
    return saida.sort((a, b) => b.altura - a.altura);
}

// Pergunta a todos os addons, com várias consultas em paralelo.
async function consultarAddons(addons, alvo, { buscarJson, concorrencia = 24, deveParar = () => false } = {}) {
    const tipo = alvo.tipo === 'tv' ? 'series' : 'movie';
    const fila = addons.filter(a => !Array.isArray(a.tipos) || a.tipos.includes(tipo));
    const achados = [];
    let feitos = 0;
    async function trabalhador() {
        while (fila.length && !deveParar()) {
            const addon = fila.shift();
            const dados = await buscarJson(addon.base + caminhoStremio(alvo)).catch(() => null);
            feitos++;
            const uteis = streamsUteis(dados && dados.streams);
            if (uteis.length) achados.push({ addon, streams: uteis });
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, fila.length || 1)) }, trabalhador));
    return { achados, consultados: feitos };
}

// Mede de verdade as melhores respostas de cada addon (até 4 espelhos).
async function medirAchados(achados, { sondar, confirmarIdioma = null, amostra = null, registrar = () => {} } = {}) {
    const aprovados = [];
    for (const achado of achados) {
        const referer = (() => { try { return new URL(achado.addon.base).origin + '/'; } catch { return ''; } })();
        let melhor = null;
        for (const stream of achado.streams.slice(0, 4)) {
            const sonda = await sondar(stream.url, referer).catch(() => null);
            if (!sonda || !sonda.viva) continue;
            let dublado = typeof sonda.dublado === 'boolean' ? sonda.dublado : null;
            if (dublado === null && typeof confirmarIdioma === 'function') {
                const ouvido = await confirmarIdioma({ url: stream.url, referer }, amostra).catch(() => null);
                if (typeof ouvido === 'boolean') dublado = ouvido;
            }
            if (dublado === false) continue;
            const altura = Number(sonda.altura) || stream.altura || 0;
            const medida = { stream, altura, dublado, evidencia: sonda.evidencia || '' };
            if (!melhor || (medida.dublado === true) > (melhor.dublado === true) || medida.altura > melhor.altura) melhor = medida;
            if (melhor.dublado === true && melhor.altura >= 1080) break;
        }
        registrar(`${achado.addon.nome}: ${melhor ? `${melhor.altura || '?'}p, áudio ${melhor.dublado === true ? 'português comprovado' : 'sem prova'}` : 'nenhum espelho tocou'}`);
        if (melhor) aprovados.push({ addon: achado.addon, ...melhor, referer });
    }
    // Dublado comprovado primeiro, depois a maior altura.
    return aprovados.sort((a, b) => Number(b.dublado === true) - Number(a.dublado === true) || b.altura - a.altura);
}

// A ficha que o app usa: o molde do endereço do addon por título.
function fichaDoAddon(addon, referer) {
    const tipos = Array.isArray(addon.tipos) && addon.tipos.length ? addon.tipos : ['movie', 'series'];
    return {
        id: idDaFicha(addon.nome, addon.base),
        nome: addon.nome,
        nota: 0,
        dublado: true,
        qualidade: '',
        tipos: [...new Set(tipos.map(t => t === 'series' ? 'tv' : t))],
        ...(tipos.includes('movie') ? { urlMovie: `${addon.base}/stream/movie/{imdb}.json` } : {}),
        ...(tipos.includes('series') ? { urlTv: `${addon.base}/stream/series/{imdb}:{temporada}:{episodio}.json` } : {}),
        referer: referer || '',
        origem: 'caçada por título (catálogo de addons)',
        stremio: true,
        ativo: false,
        medidoEm: new Date().toISOString(),
        passos: [{ tipo: 'json', caminho: 'streams[0].url' }],
    };
}

// ---------------------------------------------------------------- amostras
const FILMES_POPULARES = [
    { tipo: 'movie', id: '27205', imdb: 'tt1375666', titulo: 'A Origem' },
    { tipo: 'movie', id: '155', imdb: 'tt0468569', titulo: 'Batman: O Cavaleiro das Trevas' },
    { tipo: 'movie', id: '278', imdb: 'tt0111161', titulo: 'Um Sonho de Liberdade' },
    { tipo: 'movie', id: '872585', imdb: 'tt15398776', titulo: 'Oppenheimer' },
];
const SERIES_POPULARES = [
    { tipo: 'tv', id: '1396', imdb: 'tt0903747', temporada: 1, episodio: 2, titulo: 'Breaking Bad 1x2' },
    { tipo: 'tv', id: '66732', imdb: 'tt4574334', temporada: 1, episodio: 2, titulo: 'Stranger Things 1x2' },
    { tipo: 'tv', id: '1399', imdb: 'tt0944947', temporada: 1, episodio: 2, titulo: 'Game of Thrones 1x2' },
];
// Novelas brasileiras (reserva fixa; a lista viva vem do TMDB).
const NOVELAS_FIXAS = [
    { tipo: 'tv', id: '306956', imdb: 'tt42751057', temporada: 1, episodio: 130, titulo: 'Quem Ama Cuida 1x130' },
    { tipo: 'tv', id: '301557', imdb: 'tt39396172', temporada: 1, episodio: 150, titulo: 'A Nobreza do Amor 1x150' },
    { tipo: 'tv', id: '289996', imdb: 'tt38591370', temporada: 1, episodio: 100, titulo: 'Três Graças 1x100' },
    { tipo: 'tv', id: '283245', imdb: 'tt36759024', temporada: 1, episodio: 100, titulo: 'Dona de Mim 1x100' },
    { tipo: 'tv', id: '233519', imdb: 'tt29894217', temporada: 1, episodio: 100, titulo: 'Vale Tudo 1x100' },
    { tipo: 'tv', id: '301174', imdb: 'tt39169218', temporada: 1, episodio: 100, titulo: 'Coração Acelerado 1x100' },
];

// Novelas em exibição agora (TMDB: Brasil, gênero novela), com um capítulo
// já exibido de cada — é com elas que uma fonte de novela é validada.
async function novelasAtuais(buscarJson, { limite = 8 } = {}) {
    const desde = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const lista = await buscarJson(`https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_KEY}&language=pt-BR&with_origin_country=BR&with_genres=10766&sort_by=popularity.desc&first_air_date.gte=${desde}`).catch(() => null);
    const saida = [];
    for (const item of (lista && Array.isArray(lista.results) ? lista.results : []).slice(0, limite)) {
        const detalhe = await buscarJson(`https://api.themoviedb.org/3/tv/${item.id}?api_key=${TMDB_KEY}&append_to_response=external_ids`).catch(() => null);
        const imdb = detalhe && detalhe.external_ids && detalhe.external_ids.imdb_id;
        const ultimo = detalhe && detalhe.last_episode_to_air;
        if (!/^tt\d+$/.test(String(imdb || '')) || !ultimo || !ultimo.episode_number) continue;
        // Um capítulo de alguns dias atrás: o mais recente às vezes ainda não subiu.
        const episodio = Math.max(1, Number(ultimo.episode_number) - 3);
        saida.push({ tipo: 'tv', id: String(item.id), imdb, temporada: Number(ultimo.season_number) || 1, episodio, titulo: `${item.name} ${ultimo.season_number || 1}x${episodio}` });
    }
    const vistos = new Set(saida.map(n => n.id));
    for (const fixa of NOVELAS_FIXAS) if (!vistos.has(fixa.id)) saida.push(fixa);
    return saida;
}

async function imdbDoTitulo(alvo, buscarJson) {
    if (/^tt\d+$/.test(String(alvo.imdb || ''))) return alvo.imdb;
    const caminho = alvo.tipo === 'tv' ? `tv/${alvo.tmdbId}` : `movie/${alvo.tmdbId}`;
    const dados = await buscarJson(`https://api.themoviedb.org/3/${caminho}/external_ids?api_key=${TMDB_KEY}`).catch(() => null);
    const imdb = String(dados && dados.imdb_id || '');
    return /^tt\d+$/.test(imdb) ? imdb : '';
}
async function ehNovela(alvo, buscarJson) {
    if (alvo.tipo !== 'tv') return false;
    const d = await buscarJson(`https://api.themoviedb.org/3/tv/${alvo.tmdbId}?api_key=${TMDB_KEY}`).catch(() => null);
    const generos = (d && Array.isArray(d.genres) ? d.genres : []).map(g => g.id);
    const paises = d && Array.isArray(d.origin_country) ? d.origin_country : [];
    return generos.includes(10766) || paises.includes('BR');
}

// ---------------------------------------------------------------- caçada
// alvo: { tipo: 'movie'|'tv', tmdbId, temporada, episodio, titulo }
async function cacarTitulo(alvo, deps) {
    const { buscarJson, sondar, validar, registrarFicha, fichasAtuais = () => [], confirmarIdioma = null, pastaDados, fixos = [], registrar = () => {}, deveParar = () => false } = deps;
    const inicio = Date.now();
    const relatorio = { alvo, consultados: 0, responderam: [], aprovadas: [], recusadas: [], ms: 0 };
    const imdb = await imdbDoTitulo(alvo, buscarJson);
    if (!imdb) { relatorio.erro = 'sem código IMDb para este título'; return relatorio; }
    const completo = { ...alvo, imdb };
    const addons = await carregarCatalogo({ buscarJson, pastaDados, fixos, registrar });
    registrar(`caçada por título: ${alvo.titulo || imdb} em ${addons.length} addons`);
    const { achados, consultados } = await consultarAddons(addons, completo, { buscarJson, deveParar });
    relatorio.consultados = consultados;
    relatorio.responderam = achados.map(a => ({ addon: a.addon.nome, base: a.addon.base, streams: a.streams.length }));
    registrar(`${achados.length} addon(s) têm "${alvo.titulo || imdb}" com rótulo dublado`);
    // Quem o app já usa não precisa de ficha nova.
    const conhecidas = new Set(fichasAtuais().filter(f => f.ativo !== false).map(f => String(f.urlTv || f.urlMovie || '').split('/stream/')[0]));
    const novos = achados.filter(a => !conhecidas.has(a.addon.base));
    const medidos = await medirAchados(novos.slice(0, 12), { sondar, confirmarIdioma, amostra: { id: completo.tmdbId, temporada: completo.temporada, episodio: completo.episodio, titulo: alvo.titulo }, registrar });
    const amostras = completo.tipo === 'tv'
        ? ((await ehNovela(completo, buscarJson)) ? await novelasAtuais(buscarJson) : SERIES_POPULARES)
        : FILMES_POPULARES;
    for (const medido of medidos.slice(0, 6)) {
        if (deveParar()) break;
        const ficha = fichaDoAddon(medido.addon, medido.referer);
        // A prova do próprio título que falhou + outras amostras independentes.
        const lista = [{ tipo: completo.tipo, id: completo.tmdbId, imdb, temporada: completo.temporada, episodio: completo.episodio, titulo: alvo.titulo || imdb }, ...amostras.filter(a => a.id !== String(completo.tmdbId))];
        const avaliacao = await validar(ficha, lista, { registrar, confirmarIdioma }).catch(erro => ({ aprovada: false, motivo: String(erro.message || erro).slice(0, 80), provas: [] }));
        if (avaliacao.aprovada) {
            const registrada = registrarFicha(pastaDados, ficha, avaliacao, { cacadaPor: alvo.titulo || imdb });
            relatorio.aprovadas.push({ id: registrada.id, nome: registrada.nome, qualidade: registrada.qualidade, nota: registrada.nota });
            registrar(`✔ ${ficha.nome} aprovada (${registrada.qualidade || '?'}) — já vale para o app`);
        } else {
            relatorio.recusadas.push({ nome: ficha.nome, motivo: avaliacao.motivo || 'reprovada na validação' });
            registrar(`✘ ${ficha.nome}: ${avaliacao.motivo || 'reprovada'}`);
        }
    }
    relatorio.ms = Date.now() - inicio;
    return relatorio;
}

module.exports = {
    cacarTitulo, carregarCatalogo, consultarAddons, streamsUteis, medirAchados, fichaDoAddon, addonUtil,
    novelasAtuais, imdbDoTitulo, ehNovela, baseDoAddon, idDaFicha, marcasDeDublado, alturaDoRotulo,
    CATALOGOS, NOVELAS_FIXAS, FILMES_POPULARES, SERIES_POPULARES,
};
