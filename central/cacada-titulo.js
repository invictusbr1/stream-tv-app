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
const LIXO = /sign ?in|signin|login|token[- ]required|configure|deprecated|obsolete|auth(entication)? (error|failed)|not (active|available)|status: down|buymeacoffee|example\.com|archive\.org\/download\/bigbuckbunny|comet\.feels\.legal|donat|suspended|disabled|acces blocat|stremio-status|torbox|real-?debrid|alldebrid|premiumize|debrid-?link|offcloud|easynews/i;
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
// Animes populares com dublagem brasileira (para addons só de anime, como o Zeus).
const ANIMES_POPULARES = [
    { tipo: 'tv', id: '46260', imdb: 'tt0409591', temporada: 1, episodio: 1, titulo: 'Naruto 1x1' },
    { tipo: 'tv', id: '37854', imdb: 'tt0388629', temporada: 1, episodio: 1, titulo: 'One Piece 1x1' },
    { tipo: 'tv', id: '85937', imdb: 'tt9335498', temporada: 1, episodio: 1, titulo: 'Demon Slayer 1x1' },
    { tipo: 'tv', id: '95479', imdb: 'tt12343534', temporada: 1, episodio: 1, titulo: 'Jujutsu Kaisen 1x1' },
];
function addonDeAnime(manifest) {
    const m = manifest || {};
    const texto = `${m.name || ''} ${m.description || ''} ${(m.catalogs || []).map(c => c && c.name).join(' ')} ${JSON.stringify(m.idPrefixes || '')} ${JSON.stringify((m.resources || []).map(x => x && x.idPrefixes))}`;
    return /anime|kitsu|mal:|anilist/i.test(texto);
}
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
    const { buscarJson, sondar, validar, registrarFicha, fichasAtuais = () => [], confirmarIdioma = null, pastaDados, fixos = [], registrar = () => {}, deveParar = () => false, alturaMinima = 0 } = deps;
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
    // Caça de QUALIDADE (o título abriu, mas em 720p): só serve addon que
    // entregue este título dublado na altura pedida (1080p ou mais).
    const uteis = alturaMinima ? medidos.filter(m => m.dublado === true && m.altura >= alturaMinima) : medidos;
    if (alturaMinima && medidos.length && !uteis.length) registrar(`nenhum addon novo tem "${alvo.titulo || imdb}" dublado em ${alturaMinima}p ou mais`);
    for (const medido of uteis.slice(0, 6)) {
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

// ---------------------------------------------------------------- links do usuário
// Motivo em linguagem de gente para uma fonte que não passou: separa "não
// entregou vídeo" (login/fora do ar) de "entregou, mas não dublado/HD".
function resumoDaRecusa(avaliacao) {
    const provas = Array.isArray(avaliacao.provas) ? avaliacao.provas : [];
    const abriram = provas.filter(p => p.ok);
    if (!provas.length) return avaliacao.motivo || 'a fonte não respondeu';
    if (provas.some(p => /certificado/.test(p.motivo || ''))) return 'o servidor do vídeo tem certificado https inválido — o celular e o navegador não tocam';
    if (!abriram.length) return 'não entregou vídeo em nenhum título (pode exigir login ou estar fora do ar)';
    if (abriram.some(p => /português/i.test(p.motivo || ''))) return 'tem o vídeo, mas o áudio em português não foi comprovado';
    if (abriram.some(p => /alta definição|HD/i.test(p.motivo || ''))) return 'tem o vídeo dublado, mas abaixo de HD';
    return avaliacao.motivo || 'faltam duas provas em HD com áudio em português';
}

// O usuário cola links de fornecedores que conhece; cada um é conferido do
// mesmo jeito que uma fonte descoberta (prova de imagem e de áudio em
// português em títulos diferentes) e, se passar, é ativado. Nada de login:
// uma fonte que exige conta cai em "não entregou vídeo".
async function verificarLinks(links, deps) {
    const { buscarJson, buscar, sondar, validar, registrarFicha, fichasAtuais = () => [], confirmarIdioma = null, pastaDados, registrar = () => {} } = deps;
    const opcoesValidar = { registrar, confirmarIdioma, ...(buscar ? { buscar } : {}), ...(sondar ? { sondar } : {}) };
    const novelas = await novelasAtuais(buscarJson).catch(() => NOVELAS_FIXAS);
    const amostras = [...FILMES_POPULARES, ...novelas.slice(0, 4)];
    const jaAtivas = new Set(fichasAtuais().filter(f => f.ativo !== false).map(f => String(f.urlTv || f.urlMovie || '').split('/stream/')[0]));
    const vistos = new Set();
    const relatorio = [];
    for (const bruto of Array.isArray(links) ? links : []) {
        const base = baseDoAddon(bruto);
        if (!base) { relatorio.push({ link: String(bruto).slice(0, 80), status: 'endereço inválido', detalhe: 'use um endereço https do fornecedor' }); continue; }
        if (vistos.has(base)) continue;
        vistos.add(base);
        registrar(`conferindo ${base} …`);
        let nome = base.replace(/^https?:\/\//, '').slice(0, 60), tipos = ['movie', 'series'];
        const manifest = await buscarJson(base + '/manifest.json').catch(() => null);
        if (manifest && typeof manifest === 'object') {
            const a = addonUtil({ transportUrl: base + '/manifest.json', manifest });
            if (a) { nome = a.nome; tipos = a.tipos; }
            else if (manifest.name) nome = String(manifest.name).slice(0, 60);
        }
        // Addon que entrega pelo TorBox/Real-Debrid de alguém: é a conta paga de
        // outra pessoa (configurada no endereço). Não entra.
        const amostraDebrid = await buscarJson(base + '/stream/movie/' + FILMES_POPULARES[1].imdb + '.json').catch(() => null);
        const rotulos = (amostraDebrid && Array.isArray(amostraDebrid.streams) ? amostraDebrid.streams : []).map(x => `${x && x.name || ''} ${x && (x.title || x.description) || ''}`).join(' ');
        if (/torbox|real-?debrid|alldebrid|premiumize|debrid-?link|offcloud/i.test(rotulos)) {
            relatorio.push({ link: base, nome, status: 'recusada', detalhe: 'entrega torrents pelo TorBox/Real-Debrid (conta paga de outra pessoa, configurada no endereço) — não entra no app' });
            registrar(`✘ ${nome}: usa conta paga (debrid) de outra pessoa`);
            continue;
        }
        let ficha = fichaDoAddon({ nome, base, tipos }, base + '/');
        let avaliacao = await validar(ficha, amostras, opcoesValidar).catch(e => ({ aprovada: false, motivo: String(e.message || e).slice(0, 100), provas: [] }));
        // Addon só de anime (ex.: Zeus): os filmes e novelas de teste não existem
        // nele. Testa com animes dublados populares e vale só para séries.
        if (!avaliacao.aprovada && addonDeAnime(manifest) && tipos.includes('series')) {
            registrar(`  ${nome} é de animes: testando com animes dublados…`);
            const fichaAnime = { ...fichaDoAddon({ nome, base, tipos: ['series'] }, base + '/'), soAnime: true };
            const deAnime = await validar(fichaAnime, ANIMES_POPULARES, opcoesValidar).catch(e => ({ aprovada: false, motivo: String(e.message || e).slice(0, 100), provas: [] }));
            if (deAnime.aprovada) { ficha = fichaAnime; avaliacao = deAnime; }
            else if ((deAnime.provas || []).some(p => p.ok)) avaliacao = deAnime;
        }
        if (avaliacao.aprovada) {
            if (jaAtivas.has(base)) {
                // Já ativa: a nova medição atualiza a ficha (ex.: qualidade corrigida).
                const atual = fichasAtuais().find(f => String(f.urlTv || f.urlMovie || '').split('/stream/')[0] === base);
                const antes = atual && atual.qualidade;
                const novaQ = avaliacao.ajustes && avaliacao.ajustes.qualidade;
                let atualizada = false;
                if (atual && novaQ && novaQ !== antes && typeof registrarFicha === 'function') { registrarFicha(pastaDados, { ...atual, ...ficha, id: atual.id }, avaliacao, { atualizadaEm: new Date().toISOString() }); atualizada = true; }
                relatorio.push({ link: base, nome, status: 'já ativa', qualidade: novaQ, atualizada, detalhe: atualizada ? `qualidade atualizada: ${antes || '?'} → ${novaQ}` : '' });
                registrar(`• ${nome}: já estava ativa${atualizada ? ` — qualidade atualizada ${antes || '?'} → ${novaQ}` : ''}`);
                continue;
            }
            const r = registrarFicha(pastaDados, ficha, avaliacao, { adicionadaPor: 'link manual', adicionadaEm: new Date().toISOString() });
            relatorio.push({ link: base, nome: r.nome, status: 'aprovada', qualidade: r.qualidade, nota: r.nota });
            registrar(`✔ ${r.nome}: aprovada (${r.qualidade || '?'}) — já vale para o app`);
        } else {
            const motivo = resumoDaRecusa(avaliacao);
            relatorio.push({ link: base, nome, status: 'recusada', detalhe: motivo });
            registrar(`✘ ${nome}: ${motivo}`);
        }
    }
    return relatorio;
}

// ---------------------------------------------------------------- players
// Player embutido achado numa página (ex.: https://player.x/embed/movie/550).
// Só vira fonte se o endereço trouxer o número do título (para o app pedir
// qualquer outro filme) e se o vídeo aparecer no HTML do player, sem anúncio.
const FORMAS_DE_VIDEO = [
    /file\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /source\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
];
function videoNoHtml(html) {
    const t = String(html || '').replace(/\\\//g, '/');
    for (const forma of FORMAS_DE_VIDEO) { const m = forma.exec(t); if (m && m[1]) return m[1]; }
    return '';
}
function preencherMolde(modelo, a) {
    return String(modelo).replace(/\{imdb\}/g, a.imdb || '').replace(/\{id\}/g, a.id || '').replace(/\{temporada\}/g, String(a.temporada || 1)).replace(/\{episodio\}/g, String(a.episodio || 1));
}
async function verificarPlayer(url, deps, moldeDado = null) {
    const { buscar, validar, registrarFicha, fichasAtuais = () => [], confirmarIdioma = null, sondar, pastaDados, registrar = () => {} } = deps;
    const { moldeDePlayer, hostDe } = require('./extrair-fornecedores');
    const perfis = require('./perfis');
    const varredor = require('./varredor');
    const host = hostDe(url);
    const molde = moldeDado || moldeDePlayer(url);
    if (!molde) return { link: url, nome: host, status: 'ignorado', detalhe: 'o endereço não traz o número do título (não dá para pedir outros filmes a ele)' };
    const amostras = molde.tipo === 'tv' ? SERIES_POPULARES : FILMES_POPULARES;
    const ler = typeof buscar === 'function' ? buscar : perfis.buscarTexto;
    const origem = (() => { try { return new URL(url).origin + '/'; } catch { return ''; } })();
    let html = '';
    try { html = await ler(preencherMolde(molde.modelo, amostras[0]), origem); }
    catch (e) { return { link: url, nome: host, status: 'recusada', detalhe: 'o player não abriu (' + String(e && e.message || e).slice(0, 50) + ')' }; }
    // Tela de "Verificação" (Cloudflare Turnstile/captcha): é proteção contra robô;
    // o app não passa por ela (nem deve tentar).
    if (/challenges\.cloudflare\.com\/turnstile|hcaptcha\.com|recaptcha\/api|<title>\s*(Verifica[cç][aã]o|Just a moment|Attention Required)/i.test(html)) return { link: url, nome: host, status: 'recusada', detalhe: 'pede verificação de robô (captcha) antes do vídeo — o app não passa por isso' };
    if (varredor.sinaisDeAnuncio(html).length) return { link: url, nome: host, status: 'recusada', detalhe: 'o player tem anúncio' };
    const video = videoNoHtml(html);
    if (!video) return { link: url, nome: host, status: 'recusada', detalhe: 'o vídeo é montado por JavaScript; o app não consegue usar esse player sozinho' };
    const padrao = perfis.padraoPara(html, video);
    if (!padrao) return { link: url, nome: host, status: 'recusada', detalhe: 'não achei uma regra estável para tirar o vídeo do player' };
    const ficha = {
        id: idDaFicha(host.replace(/^www\./, '').split('.')[0], url), nome: host.replace(/^www\./, ''), nota: 0, dublado: true, qualidade: '',
        tipos: [molde.tipo], [molde.tipo === 'tv' ? 'urlTv' : 'urlMovie']: molde.modelo,
        referer: origem, origem: 'link manual (player)', ativo: false, medidoEm: new Date().toISOString(),
        passos: [{ tipo: 'regex', padrao, grupo: 1, juntarComBase: true }],
    };
    if (fichasAtuais().some(f => f.ativo !== false && (f.urlMovie === molde.modelo || f.urlTv === molde.modelo))) return { link: url, nome: ficha.nome, status: 'já ativa' };
    registrar(`conferindo o player ${ficha.nome} (${molde.tipo === 'tv' ? 'séries' : 'filmes'}) …`);
    const opcoes = { registrar, confirmarIdioma, ...(typeof buscar === 'function' ? { buscar } : {}), ...(sondar ? { sondar } : {}) };
    const avaliacao = await validar(ficha, amostras, opcoes).catch(e => ({ aprovada: false, motivo: String(e.message || e).slice(0, 100), provas: [] }));
    if (!avaliacao.aprovada) { const detalhe = resumoDaRecusa(avaliacao); registrar(`✘ ${ficha.nome}: ${detalhe}`); return { link: url, nome: ficha.nome, status: 'recusada', detalhe }; }
    const r = registrarFicha(pastaDados, ficha, avaliacao, { adicionadaPor: 'link manual', adicionadaEm: new Date().toISOString() });
    registrar(`✔ ${r.nome}: aprovada (${r.qualidade || '?'}) — já vale para o app`);
    return { link: url, nome: r.nome, status: 'aprovada', qualidade: r.qualidade, nota: r.nota };
}

// Endereços candidatos a addon a partir de um link qualquer do mesmo site:
// o caminho cortado antes de /configure, /stream, /play… e a raiz do site.
async function addonPorTras(url, { buscarJson } = {}) {
    if (typeof buscarJson !== 'function') return '';
    let u; try { u = new URL(url); } catch { return ''; }
    const caminho = u.pathname.replace(/\/(configure|install|stream|play|player|embed|e|v|watch|catalog|meta)(\/.*)?$/i, '').replace(/\/+$/, '');
    const bases = [...new Set([u.origin + caminho, u.origin])];
    for (const base of bases) {
        const m = await buscarJson(base + '/manifest.json').catch(() => null);
        const recursos = m && Array.isArray(m.resources) ? m.resources.map(r => typeof r === 'string' ? r : r && r.name) : [];
        if (m && m.id && recursos.includes('stream')) return base;
    }
    return '';
}

// Vários links de PÁGINAS: extrai os fornecedores de cada uma (addons e
// players) e confere todos. É o que o painel chama no "Verificar links".
// Fornecedores que o app JÁ usa (fichas + fontes embutidas no código): não
// precisam de teste — a página só confirma que estão vivos.
let _fontesDoCodigo = null;
function fontesDoApp(deps = {}) {
    const mapa = new Map();
    const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
    for (const f of (typeof deps.fichasAtuais === 'function' ? deps.fichasAtuais() : [])) {
        if (f.ativo === false) continue;
        for (const u of [f.urlMovie, f.urlTv, f.referer]) { const h = host(String(u || '').replace(/\{[^}]+\}/g, 'x')); if (h) mapa.set(h, f.nome || f.id); }
    }
    if (!_fontesDoCodigo) {
        _fontesDoCodigo = new Map();
        const raiz = path.join(__dirname, '..');
        try {
            for (const arq of fs.readdirSync(raiz).filter(a => /-source\.js$|^clickhost-delivery\.cjs$/.test(a))) {
                const nome = arq.replace(/-source\.js$|-delivery\.cjs$/, '').replace(/-/g, ' ');
                for (const m of fs.readFileSync(path.join(raiz, arq), 'utf8').matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
                    const h = m[1].toLowerCase().replace(/^www\./, '');
                    if (!/themoviedb|tmdb|imdb|google|github|cloudflare|jsdelivr/.test(h)) _fontesDoCodigo.set(h, nome);
                }
            }
        } catch { /* sem pasta */ }
    }
    for (const [h, n] of _fontesDoCodigo) if (!mapa.has(h)) mapa.set(h, n);
    return mapa;
}
function fonteConhecida(url, mapa) {
    let h = ''; try { h = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
    for (const [conhecido, nome] of mapa) if (h === conhecido || h.endsWith('.' + conhecido) || conhecido.endsWith('.' + h)) return nome;
    return '';
}

// Vários links de PÁGINAS: extrai os fornecedores de cada uma (addons e
// players) e confere todos. É o que o painel chama no "Verificar links".
//
// Página inicial de site (sem player com número do filme): entra num FILME do
// site (capa ou busca), abre no navegador escondido, clica nos botões de
// servidor e anota cada player. Fornecedor que o app já usa é reconhecido.
async function verificarPaginas(links, deps) {
    const { extrairFornecedores, moldeDePlayer, hostDe } = require('./extrair-fornecedores');
    const registrar = deps.registrar || (() => {});
    const buscarTexto = typeof deps.buscar === 'function' ? deps.buscar : require('./perfis').buscarTexto;
    const paginas = [], addons = new Set(), players = new Map(), moldes = new Map(), hostsDasPaginas = new Set();
    const conhecidas = fontesDoApp(deps);
    const lerPagina = async (link, extra = {}) => {
        registrar(`lendo a página ${link}`);
        const ex = await extrairFornecedores(link, { buscarTexto, espionar: deps.espionar, registrar, ...extra }).catch(e => ({ origem: link, addons: [], players: [], videos: [], como: [], erro: String(e.message || e).slice(0, 80) }));
        hostsDasPaginas.add(hostDe(ex.origem).replace(/^www\./, ''));
        paginas.push({ link: ex.origem, addons: ex.addons.length, players: ex.players.length + (ex.moldes || []).length, videos: ex.videos.length, como: (ex.como || []).join(' + '), aviso: ex.erro || ex.aviso || '', hostsDeVideo: [...new Set(ex.videos.map(hostDe))].slice(0, 5) });
        registrar(`  ${ex.addons.length} addon(s), ${ex.players.length} player(s), ${ex.videos.length} vídeo(s) direto(s)${ex.aviso ? ' — ' + ex.aviso : ''}`);
        return ex;
    };
    const juntar = ex => {
        ex.addons.forEach(a => addons.add(a));
        for (const m of ex.moldes || []) {
            // Molde de addon (…/stream/movie/{imdb}.json) é addon; o resto é player.
            if (/\/stream\/(movie|series)\//.test(m.modelo)) addons.add(m.modelo.split('/stream/')[0]);
            else if (!moldes.has(m.modelo)) moldes.set(m.modelo, m);
        }
        for (const p of ex.players) { const m = moldeDePlayer(p); const chave = hostDe(p) + '|' + (m ? m.modelo : 'sem-molde'); if (!players.has(chave)) players.set(chave, p); }
    };
    const cadeias = [];
    for (const link of (Array.isArray(links) ? links : []).slice(0, 30)) {
        const ex = await lerPagina(link, deps.paginaDeFilme ? { espionarSemMolde: true } : {});
        // Site com player PRÓPRIO: a página do site tem o número do título e o
        // player usa um código do site. A cadeia é: página do site → player → vídeo.
        const moldePagina = require('./extrair-fornecedores').moldeDePagina(ex.origem);
        if (moldePagina) for (const p of ex.players) if (!moldeDePlayer(p) && hostDe(p) !== hostDe(ex.origem)) cadeias.push({ pagina: ex.origem, molde: moldePagina, player: p });
        // Página que não mostra nada pode ser o próprio addon (a raiz do site
        // às vezes é só a tela de instalar): pergunta pelo /manifest.json.
        if (!ex.addons.length && !ex.players.length && !ex.erro) {
            const achado = await addonPorTras(ex.origem, deps).catch(() => '');
            if (achado) { ex.addons.push(achado); paginas[paginas.length - 1].addons = 1; paginas[paginas.length - 1].como = [paginas[paginas.length - 1].como, 'manifest do addon'].filter(Boolean).join(' + '); registrar(`  ${hostDe(achado)} é um addon`); }
        }
        juntar(ex);
        // Capa de site: os players com número do filme só aparecem na página do filme.
        const temNumero = ex.players.some(p => moldeDePlayer(p)) || (ex.moldes || []).length > 0;
        if (!deps.paginaDeFilme && !ex.addons.length && !temNumero && !ex.erro) {
            const filmes = await paginasDeFilme(ex.origem, { ...deps, buscar: buscarTexto });
            if (filmes.length) registrar(`  é a capa do site: abrindo ${Math.min(2, filmes.length)} página(s) de filme para ver os players de verdade`);
            for (const f of filmes.slice(0, 2)) juntar(await lerPagina(f, { espionarSemMolde: true }));
        }
    }
    // Player sem número do título pode ser, na verdade, um ADDON (sites que
    // listam addons costumam linkar o endereço de instalar/configurar). Antes
    // de ignorar, pergunta ao endereço se ele tem /manifest.json de addon.
    const resultados = [];
    const jaDitas = new Set();
    for (const [chave, p] of [...players.entries()]) {
        // O próprio site (iframe dele mesmo) não é fornecedor.
        if (hostsDasPaginas.has(hostDe(p).replace(/^www\./, ''))) { players.delete(chave); continue; }
        const fonte = fonteConhecida(p, conhecidas);
        if (fonte) {
            players.delete(chave);
            if (!jaDitas.has(fonte)) { jaDitas.add(fonte); resultados.push({ link: p, nome: hostDe(p), status: 'já usada pelo app', detalhe: `é a fonte "${fonte}" que o app já usa` }); }
            continue;
        }
        if (!chave.endsWith('|sem-molde')) continue;
        if (cadeias.some(c => c.player === p)) { players.delete(chave); continue; }
        const achado = await addonPorTras(p, deps).catch(() => '');
        if (achado) { registrar(`  ${hostDe(p)} é um addon (${achado})`); addons.add(achado); players.delete(chave); continue; }
        players.delete(chave);
        if (!players.has(hostDe(p) + '|') && !resultados.some(r => r.nome === hostDe(p))) resultados.push({ link: p, nome: hostDe(p), status: 'código próprio', detalhe: 'o player usa um código do próprio site (não o número do filme no TMDB/IMDb), então não dá para pedir outros títulos a ele' });
    }
    // Moldes do código do site: fornecedor conhecido é marcado; o resto é testado
    // com o número de filmes/séries de verdade.
    const testarMoldes = [];
    for (const m of moldes.values()) {
        const exemplo = preencherMolde(m.modelo, m.tipo === 'tv' ? SERIES_POPULARES[0] : FILMES_POPULARES[0]);
        const fonte = fonteConhecida(exemplo, conhecidas);
        if (fonte) { if (!jaDitas.has(fonte)) { jaDitas.add(fonte); resultados.push({ link: m.modelo, nome: hostDe(exemplo), status: 'já usada pelo app', detalhe: `é a fonte "${fonte}" que o app já usa` }); } continue; }
        // Some com o player "solto" do mesmo host (o molde é mais preciso).
        for (const [chave, p] of [...players.entries()]) if (hostDe(p) === hostDe(exemplo)) players.delete(chave);
        testarMoldes.push({ m, exemplo });
    }
    for (const r of [...resultados]) if (r.status === 'código próprio' && testarMoldes.some(t => hostDe(t.exemplo) === r.nome)) resultados.splice(resultados.indexOf(r), 1);
    if (addons.size) {
        const novos = [...addons].filter(a => { const f = fonteConhecida(a, conhecidas); if (f && !jaDitas.has(f)) { jaDitas.add(f); resultados.push({ link: a, nome: hostDe(a), status: 'já usada pelo app', detalhe: `é a fonte "${f}" que o app já usa` }); } return !f; });
        if (novos.length) resultados.push(...await verificarLinks(novos, deps));
    }
    for (const c of cadeias.slice(0, 4)) resultados.push(await verificarCadeia(c, deps).catch(e => ({ link: c.pagina, nome: hostDe(c.player), status: 'recusada', detalhe: String(e.message || e).slice(0, 80) })));
    for (const { m, exemplo } of testarMoldes.slice(0, 12)) {
        registrar(`  testando o molde ${m.modelo}`);
        const r = await verificarPlayer(exemplo, deps, m).catch(e => ({ link: exemplo, status: 'recusada', detalhe: String(e.message || e).slice(0, 80) }));
        resultados.push({ ...r, link: m.modelo, detalhe: r.detalhe || '' });
    }
    for (const p of [...players.values()].slice(0, 12)) resultados.push(await verificarPlayer(p, deps).catch(e => ({ link: p, status: 'recusada', detalhe: String(e.message || e).slice(0, 80) })));
    return { paginas, resultados };
}

// ---------------------------------------------------------------- player próprio
// Site que usa o PRÓPRIO player (ex.: pomfy.my/assistir/969681 → pomfy-cdn.shop/e/código).
// Vira uma ficha em cadeia: página do site (com o número do filme) → endereço
// do player (lido da página) → vídeo (lido do player). Antes, confere que o
// número é mesmo do TMDB/IMDb: a página de "A Origem" tem que dizer "A Origem".
const normalizarTitulo = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function paginaEhDoTitulo(html, titulo) {
    const alvo = normalizarTitulo(String(titulo).replace(/\s+\d+x\d+$/, '').split(':')[0]);
    const cabeca = normalizarTitulo(((/<title[^>]*>([^<]{0,200})/i.exec(html) || [])[1] || '') + ' ' + ((/<h1[^>]*>([^<]{0,200})/i.exec(html) || [])[1] || '') + ' ' + ((/property=["']og:title["'][^>]*content=["']([^"']{0,200})/i.exec(html) || [])[1] || ''));
    return alvo.length >= 3 && cabeca.includes(alvo);
}
async function verificarCadeia({ pagina, molde, player }, deps) {
    const { buscar, validar, registrarFicha, fichasAtuais = () => [], confirmarIdioma = null, sondar, pastaDados, registrar = () => {}, espionar = null } = deps;
    const { hostDe } = require('./extrair-fornecedores');
    const perfis = require('./perfis');
    const varredor = require('./varredor');
    const ler = typeof buscar === 'function' ? buscar : perfis.buscarTexto;
    const hostPlayer = hostDe(player), hostSite = hostDe(pagina);
    const nome = `${hostSite.replace(/^www\./, '')} (player próprio)`;
    const amostras = molde.tipo === 'tv' ? SERIES_POPULARES : FILMES_POPULARES;
    const origem = new URL(pagina).origin + '/';
    registrar(`site com player próprio: ${hostSite} → ${hostPlayer}; conferindo se o número do endereço é o do filme…`);
    // 1. Identidade: o número no endereço é o do TMDB/IMDb?
    let htmlSite = '', bateu = 0;
    for (const a of amostras.slice(0, 2)) {
        const h = await ler(preencherMolde(molde.modelo, a), origem).catch(() => '');
        if (paginaEhDoTitulo(h, a.titulo)) { bateu++; if (!htmlSite) htmlSite = h; }
    }
    if (!bateu) return { link: pagina, nome, status: 'código próprio', detalhe: `o número no endereço do ${hostSite} não é o do TMDB/IMDb (a página de "${amostras[0].titulo}" não abriu esse filme)` };
    // 2. Do site ao player: regra para achar o player na página.
    const esc = hostPlayer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const padraoPlayer = `(https?:\\/\\/(?:www\\.)?${esc}\\/[^"'\\s<>]+)`;
    const enderecoPlayer = (new RegExp(padraoPlayer, 'i').exec(htmlSite) || [])[1];
    if (!enderecoPlayer) return { link: pagina, nome, status: 'recusada', detalhe: `a página do filme não mostra o player ${hostPlayer} no HTML (só depois de rodar o script do site)` };
    // 3. Do player ao vídeo.
    const htmlPlayer = await ler(enderecoPlayer.replace(/^http:/i, 'https:'), origem).catch(() => '');
    if (/challenges\.cloudflare\.com\/turnstile|hcaptcha|recaptcha\/api|\/pow[-.][a-z0-9]+\.js|proof.?of.?work/i.test(htmlPlayer)) return { link: pagina, nome, status: 'recusada', detalhe: `o player ${hostPlayer} é protegido contra robô (captcha/prova de trabalho) — o app não passa por isso` };
    if (varredor.sinaisDeAnuncio(htmlPlayer).length) return { link: pagina, nome, status: 'recusada', detalhe: `o player ${hostPlayer} tem anúncio` };
    const video = videoNoHtml(htmlPlayer);
    if (!video) {
        // Último recurso: abre o player no navegador escondido para entender por quê.
        let motivo = `o vídeo do player ${hostPlayer} é montado por JavaScript; o app não consegue usar esse player sozinho`;
        if (typeof espionar === 'function') {
            const r = await espionar(enderecoPlayer, { referer: pagina, segundos: 12, registrar }).catch(() => null);
            const pedidos = r ? [...(r.pedidos || []), ...(r.chamadas || []).map(c => c.url)] : [];
            if (pedidos.some(u => /\/pow[-.]|turnstile|captcha|challenge/i.test(u))) motivo = `o player ${hostPlayer} é protegido contra robô (prova de trabalho/captcha) — o app não passa por isso`;
            else if (r && (r.videos || []).length) motivo = `o player ${hostPlayer} só entrega o vídeo depois de uma chamada interna do script (o app não consegue repetir sozinho)`;
        }
        return { link: pagina, nome, status: 'recusada', detalhe: motivo };
    }
    const padraoVideo = perfis.padraoPara(htmlPlayer, video);
    if (!padraoVideo) return { link: pagina, nome, status: 'recusada', detalhe: 'não achei uma regra estável para tirar o vídeo do player' };
    const ficha = {
        id: idDaFicha(hostSite.replace(/^www\./, '').split('.')[0], pagina), nome: hostSite.replace(/^www\./, ''), nota: 0, dublado: true, qualidade: '',
        tipos: [molde.tipo], [molde.tipo === 'tv' ? 'urlTv' : 'urlMovie']: molde.modelo,
        referer: origem, origem: 'link manual (player próprio)', ativo: false, medidoEm: new Date().toISOString(),
        passos: [{ tipo: 'regex', padrao: padraoPlayer, grupo: 1 }, { tipo: 'regex', padrao: padraoVideo, grupo: 1, juntarComBase: true }],
    };
    if (fichasAtuais().some(f => f.ativo !== false && (f.urlMovie === molde.modelo || f.urlTv === molde.modelo))) return { link: pagina, nome: ficha.nome, status: 'já ativa' };
    registrar(`conferindo ${ficha.nome} em ${amostras.length} títulos…`);
    const opcoes = { registrar, confirmarIdioma, ...(typeof buscar === 'function' ? { buscar } : {}), ...(sondar ? { sondar } : {}) };
    const avaliacao = await validar(ficha, amostras, opcoes).catch(e => ({ aprovada: false, motivo: String(e.message || e).slice(0, 100), provas: [] }));
    if (!avaliacao.aprovada) return { link: pagina, nome: ficha.nome, status: 'recusada', detalhe: resumoDaRecusa(avaliacao) };
    const reg = registrarFicha(pastaDados, ficha, avaliacao, { adicionadaPor: 'link manual (player próprio)', adicionadaEm: new Date().toISOString() });
    return { link: pagina, nome: reg.nome, status: 'aprovada', qualidade: reg.qualidade, nota: reg.nota };
}

// ---------------------------------------------------------------- site inteiro
// Site de filmes (NetCine, OverFlix…): a página inicial não tem player. Abre
// a página de um FILME do próprio site (pelo link da capa ou pela busca) e
// confere os players que ela usa por dentro — é ali que mora o fornecedor.
const BUSCAS_NO_SITE = ['/?s={q}', '/pesquisar/?q={q}', '/search?q={q}', '/busca/{q}', '/pesquisa/{q}'];
const FILMES_DE_TESTE = ['a origem', 'vingadores ultimato', 'divertida mente'];
function linksDeFilme(html, base) {
    const { normalizar } = require('./extrair-fornecedores');
    let host = ''; try { host = new URL(base).hostname.replace(/^www\./, ''); } catch { return []; }
    const vistos = new Set();
    for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        const u = normalizar(m[1], base);
        if (!u) continue;
        let url; try { url = new URL(u); } catch { continue; }
        if (url.hostname.replace(/^www\./, '') !== host) continue;
        const caminho = url.pathname.toLowerCase();
        if (!/\/(filme|filmes|movie|movies|assistir|watch|f)\/[^/]{3,}/.test(caminho)) continue;
        if (/\/(categoria|category|genero|genre|tag|page|pagina|ano|year|lancamentos?)\b/.test(caminho)) continue;
        vistos.add(url.href);
        if (vistos.size >= 8) break;
    }
    return [...vistos];
}

// Páginas de FILME do site (pela capa ou pela busca do próprio site).
async function paginasDeFilme(origemUrl, deps) {
    const buscarTexto = typeof deps.buscar === 'function' ? deps.buscar : require('./perfis').buscarTexto;
    let origem; try { origem = new URL(origemUrl).origin; } catch { return []; }
    let filmes = linksDeFilme(await buscarTexto(origem + '/', '').catch(() => ''), origem + '/');
    for (const q of FILMES_DE_TESTE) {
        if (filmes.length >= 2) break;
        for (const molde of BUSCAS_NO_SITE) {
            const achados = linksDeFilme(await buscarTexto(origem + molde.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+')), origem + '/').catch(() => ''), origem + '/');
            if (achados.length) { filmes = [...new Set([...filmes, ...achados])]; break; }
        }
    }
    return filmes;
}

async function explorarSite(url, deps) {
    const registrar = deps.registrar || (() => {});
    const buscarTexto = typeof deps.buscar === 'function' ? deps.buscar : require('./perfis').buscarTexto;
    let origem; try { origem = new URL(url).origin; } catch { return { paginas: [], resultados: [{ link: url, status: 'endereço inválido' }] }; }
    registrar(`abrindo o site ${origem} para achar a página de um filme…`);
    let filmes = linksDeFilme(await buscarTexto(origem + '/', '').catch(() => ''), origem + '/');
    for (const q of FILMES_DE_TESTE) {
        if (filmes.length >= 2) break;
        for (const molde of BUSCAS_NO_SITE) {
            const html = await buscarTexto(origem + molde.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+')), origem + '/').catch(() => '');
            const achados = linksDeFilme(html, origem + '/');
            if (achados.length) { filmes = [...new Set([...filmes, ...achados])]; break; }
        }
    }
    // Fornecedor de player (ex.: WarezCDN): responde direto pelo número do filme.
    if (!filmes.length) {
        const host = new URL(origem).hostname.replace(/^www\./, '');
        const raizes = [origem, `https://embed.${host}`];
        const caminhos = ['/filme/tt1375666', '/embed/movie/27205', '/movie/27205', '/embed/tt1375666', '/e/tt1375666', '/filme/27205'];
        let inicial = ''; try { inicial = await buscarTexto(origem + '/', ''); } catch { /* sem capa */ }
        for (const raiz of raizes) for (const c of caminhos) {
            const html = await buscarTexto(raiz + c, origem + '/').catch(() => '');
            if (html && html.length > 300 && html !== inicial && !/404|not found|não encontrad/i.test(html.slice(0, 2000))) {
                registrar(`  ${raiz + c} responde como player — conferindo`);
                return { paginas: [], resultados: [await verificarPlayer(raiz + c, deps).catch(e => ({ link: raiz + c, status: 'recusada', detalhe: String(e.message || e).slice(0, 80) }))] };
            }
        }
    }
    if (!filmes.length) { registrar(`  não achei página de filme em ${origem}`); return { paginas: [], resultados: [{ link: origem, nome: new URL(origem).hostname, status: 'recusada', detalhe: 'não achei a página de um filme no site (busca e capa)' }] }; }
    registrar(`  ${filmes.length} página(s) de filme; conferindo os players de ${Math.min(2, filmes.length)}`);
    const r = await verificarPaginas(filmes.slice(0, 2), { ...deps, paginaDeFilme: true });
    if (!r.resultados.length) r.resultados.push({ link: filmes[0], nome: new URL(origem).hostname, status: 'recusada', detalhe: 'a página do filme não mostrou nenhum player ou addon' });
    return r;
}

module.exports = {
    verificarCadeia, paginaEhDoTitulo, explorarSite, linksDeFilme, paginasDeFilme, fontesDoApp, fonteConhecida,
    cacarTitulo, verificarLinks, verificarPlayer, verificarPaginas, addonPorTras, resumoDaRecusa, videoNoHtml, carregarCatalogo, consultarAddons, streamsUteis, medirAchados, fichaDoAddon, addonUtil,
    novelasAtuais, imdbDoTitulo, ehNovela, baseDoAddon, idDaFicha, marcasDeDublado, alturaDoRotulo,
    ANIMES_POPULARES, addonDeAnime, CATALOGOS, NOVELAS_FIXAS, FILMES_POPULARES, SERIES_POPULARES,
};
