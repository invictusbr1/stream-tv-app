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
    'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,bludv|language=portuguese|qualityfilter=scr,cam',
    'https://torrentio.strem.fun',
    'https://cinema.debrid.in',
    // Torrentio Brazuca (lista da comunidade, conferido em 07/11/2026): trouxe
    // dublados prontos na TorBox que as outras listas não tinham.
    'https://torrentio.strem.fun/brazuca',
];
// Listas aprovadas pelo caçador (perfis.json → "listasTorbox"): somam às fixas
// acima, sem precisar atualizar o servidor. TODAS são consultadas ao mesmo
// tempo (4 s cada, no máximo): um título que só uma delas tem não pode ficar
// de fora. O teto de 20 só existe contra uma lista publicada com erro.
function listas() {
    let extras = [];
    try { extras = require('./perfis-locais').listasTorbox(); } catch { extras = []; }
    const bases = (Array.isArray(extras) ? extras : []).filter(l => l && l.ativo !== false && /^https:\/\/[^\s"']+$/.test(String(l.base || ''))).map(l => String(l.base).replace(/\/+$/, ''));
    return [...new Set([...LISTAS, ...bases])].slice(0, 20);
}
// Listas de ANIME: as fixas + as que o caçador aprovou só para anime.
function listasAnime() {
    let extras = [];
    try { extras = require('./perfis-locais').listasAnime(); } catch { extras = []; }
    const bases = (Array.isArray(extras) ? extras : []).filter(l => l && l.ativo !== false && /^https:\/\/[^\s"']+$/.test(String(l.base || ''))).map(l => String(l.base).replace(/\/+$/, ''));
    return [...new Set([...LISTAS_ANIME, ...bases])].slice(0, 12);
}
const VALIDADE = 2 * 60 * 60 * 1000;      // link e resultado por título
const VALIDADE_VAZIO = 20 * 60 * 1000;    // "não tem" é revisto em 20 min
// Teste de 06/11/2026 (botão "TorBox: testar slots"): filme já pronto no
// cache entra na conta como "cached", NÃO ativo — não ocupa slot — e o link
// continua tocando depois de apagado. Mesmo assim a conta é mantida enxuta:
// sai o que tem mais de 24 h e nunca ficam mais de 60 (os mais antigos saem).
const GUARDAR_NA_CONTA = 24 * 60 * 60 * 1000;
const MAXIMO_NA_CONTA = 60;
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
function escolherTorrents(streams, emCache, porQualidade = 1, { hevcOk = false } = {}) {
    const pt = (streams || []).filter(s => s && hashDe(s) && emCache.has(hashDe(s)) && ehPortugues(rotuloDe(s)) && !/\b(?:cam|ts|hdcam|telesync)\b/i.test(rotuloDe(s)));
    const escolhidos = [];
    // 4K: quase sempre H.265 (é aceito só nele); Dolby Vision sem HDR de
    // reserva fica de fora já pelo rótulo (ver também a leitura do arquivo).
    const serve = (s, q) => q === '4K'
        ? !(/\b(?:dv|dovi|dolby.?vision)\b/i.test(rotuloDe(s)) && !/\bhdr/i.test(rotuloDe(s)))
        // Full HD/HD em H.265 (x265) é muito comum nos lançamentos brasileiros:
        // vale para aparelho que toca H.265 (hevcOk); para os outros, não.
        : hevcOk || !ehHevc(rotuloDe(s));
    for (const q of ['4K', '1080p', '720p']) {
        const daQualidade = pt.filter(s => qualidade(rotuloDe(s)) === q && serve(s, q))
            .sort((a, b) => (dubladoExplicito(rotuloDe(b)) - dubladoExplicito(rotuloDe(a)))
                || (q !== '4K' ? ehHevc(rotuloDe(a)) - ehHevc(rotuloDe(b)) : 0)
                || (tamanhoGB(rotuloDe(b)) - tamanhoGB(rotuloDe(a))));
        for (const stream of daQualidade.slice(0, porQualidade)) escolhidos.push({ stream, qualidade: q });
    }
    return escolhidos;
}

// Arquivo certo dentro do torrent (pacote de temporada tem vários).
function escolherArquivo(arquivos, { nome = '', temporada = 0, episodio = 0, indice = null } = {}) {
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
        // Nome fora do padrão (ex.: "Episodio 03.mkv"): vale o arquivo que a
        // lista indicou (fileIdx), desde que o nome traga o número do episódio.
        if (indice !== null && indice !== undefined) {
            const porIndice = videos.find(a => Number(a.id) === Number(indice));
            if (porIndice && new RegExp(`(?:^|[^a-z0-9])(?:e|ep|episodio|episódio|episode|cap|capitulo)?[ ._-]*0*${e}(?!\\d)`, 'i').test(curto(porIndice))) return porIndice;
        }
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
    // Com várias listas o número de torrents passa de 100: consulta TODOS,
    // em lotes de 80 ao mesmo tempo (antes, o que passava de 100 era ignorado).
    const unicos = [...new Set(hashes.filter(Boolean).map(h => String(h).toLowerCase()))].slice(0, 800);
    if (!unicos.length) return achados;
    const lotes = [];
    for (let i = 0; i < unicos.length; i += 80) lotes.push(unicos.slice(i, i + 80));
    await Promise.all(lotes.map(async lote => {
        const r = await pedir(`${API}/torrents/checkcached?hash=${lote.join(',')}&format=object`, { headers: { Authorization: `Bearer ${chave}` } });
        const dados = r.json && r.json.data;
        if (dados && typeof dados === 'object' && !Array.isArray(dados)) for (const h of Object.keys(dados)) achados.add(h.toLowerCase());
        else if (Array.isArray(dados)) for (const d of dados) if (d && d.hash) achados.add(String(d.hash).toLowerCase());
    }));
    return achados;
}

async function minhaLista(chave) {
    const r = await pedir(`${API}/torrents/mylist?bypass_cache=true`, { headers: { Authorization: `Bearer ${chave}` } });
    return Array.isArray(r.json && r.json.data) ? r.json.data : [];
}

// Apaga da conta o que foi aberto há mais de 2 dias (no máximo a cada 6 h).
async function limparConta(chave, lista) {
    if (Date.now() - ultimaLimpeza < 60 * 60 * 1000) return;
    ultimaLimpeza = Date.now();
    const ordenada = [...lista].sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
    for (const [posicao, t] of ordenada.entries()) {
        const criado = Date.parse(t.created_at || '') || 0;
        // Ativo (baixando de verdade) nunca é apagado aqui.
        if (t.active) continue;
        const velho = criado && Date.now() - criado >= GUARDAR_NA_CONTA;
        if (!velho && posicao < MAXIMO_NA_CONTA) continue;
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

// Rapidez (07/11/2026): a parte de "quais torrents existem e estão prontos"
// fica guardada 10 min por título (o motor 1 e o motor 2 dividem); cada
// arquivo já conferido (link + leitura do áudio) fica guardado 2 h; e a conta
// é arrumada em segundo plano, fora do caminho de quem está esperando o play.
const preludios = new Map();
const conferidos = new Map();
const emConferencia = new Map();
const PRELUDIO_VALIDADE = 10 * 60 * 1000;
let limpezaAgendada = false;
function manterConta(chave) {
    if (limpezaAgendada || Date.now() - ultimaLimpeza < 60 * 60 * 1000) return;
    limpezaAgendada = true;
    setImmediate(() => { minhaLista(chave).then(lista => limparConta(chave, lista)).catch(() => {}).finally(() => { limpezaAgendada = false; }); });
}

async function buscar(chave, tipo, tmdbId, temporada, episodio, rastro = [], { qualidades = ['4K', '1080p', '720p'], primeiro = false, hevcOk = false } = {}) {
    const ehSerie = tipo === 'tv';
    const imdb = await require('./fenix-source').imdbDe(tmdbId, ehSerie ? 'tv' : 'movie');
    if (!imdb) { rastro.push('sem código IMDb no TMDB'); return []; }
    const caminho = ehSerie ? `series/${imdb}:${temporada || 1}:${episodio || 1}` : `movie/${imdb}`;
    const guardado = preludios.get(caminho);
    if (guardado && guardado.expira > Date.now()) return depoisDoPreludio(chave, guardado.valor, { ehSerie, temporada, episodio, rastro, qualidades, primeiro, hevcOk });
    // Lista lenta não segura as outras: 4 s cada, todas ao mesmo tempo.
    const respostas = await Promise.all(listas().map(base => pedir(`${base}/stream/${caminho}.json`, {}, 4000)));
    const streams = juntar(respostas.map(r => (r.json && Array.isArray(r.json.streams) ? r.json.streams : [])));
    const hashes = streams.filter(s => ehPortugues(rotuloDe(s))).map(hashDe);
    const emCache = await emCacheNaTorBox(chave, hashes);
    const escolhidos = escolherTorrents(streams, emCache, 4, { hevcOk });
    preludios.set(caminho, { valor: { streams, emCache, imdb }, expira: Date.now() + PRELUDIO_VALIDADE });
    if (preludios.size > 300) preludios.delete(preludios.keys().next().value);
    rastro.push(`${imdb}: listas ${respostas.map(r => r.status + '/' + ((r.json && r.json.streams) || []).length).join(' ')} · ${streams.length} torrents · ${hashes.length} PT · ${emCache.size} prontos · escolhidos ${escolhidos.map(e => e.qualidade).join('+') || 'nenhum'}`);
    return depoisDoPreludio(chave, { streams, emCache, imdb }, { ehSerie, temporada, episodio, rastro, qualidades, primeiro, hevcOk });
}

// Só "existe torrent dublado pronto nesta qualidade?" — sem abrir nada. É o
// que permite ao motor 1 desistir NA HORA quando a TorBox não tem o título
// (e esperar com calma quando tem).
async function preludio(tipo, tmdbId, temporada, episodio, { hevcOk = false } = {}) {
    const chave = lerChave();
    const id = String(tmdbId || '').trim();
    if (!chave || !/^\d{1,10}$/.test(id) || (tipo !== 'movie' && tipo !== 'tv')) return null;
    const ehSerie = tipo === 'tv';
    const imdb = await require('./fenix-source').imdbDe(id, ehSerie ? 'tv' : 'movie');
    if (!imdb) return { qualidades: [] };
    const caminho = ehSerie ? `series/${imdb}:${temporada || 1}:${episodio || 1}` : `movie/${imdb}`;
    let guardado = preludios.get(caminho);
    if (!guardado || guardado.expira <= Date.now()) {
        const respostas = await Promise.all(listas().map(base => pedir(`${base}/stream/${caminho}.json`, {}, 4000)));
        const streams = juntar(respostas.map(r => (r.json && Array.isArray(r.json.streams) ? r.json.streams : [])));
        const emCache = await emCacheNaTorBox(chave, streams.filter(s => ehPortugues(rotuloDe(s))).map(hashDe));
        guardado = { valor: { streams, emCache, imdb }, expira: Date.now() + PRELUDIO_VALIDADE };
        preludios.set(caminho, guardado);
    }
    const escolhidos = escolherTorrents(guardado.valor.streams, guardado.valor.emCache, 4, { hevcOk });
    return { qualidades: [...new Set(escolhidos.map(e => e.qualidade))] };
}

async function depoisDoPreludio(chave, { streams, emCache }, { ehSerie, temporada, episodio, rastro, qualidades, primeiro, hevcOk = false }) {
    // Até 4 reservas por qualidade: se o arquivo do primeiro não tiver áudio
    // em português (conferido abaixo), tenta o seguinte.
    const escolhidos = escolherTorrents(streams, emCache, 4, { hevcOk });
    if (!escolhidos.length) { const vazio = []; vazio.semCandidatos = true; return vazio; }
    manterConta(chave);
    const tentarNovo = async ({ stream, qualidade: q }) => {
        // Sem ler a conta inteira: criar de novo um torrent que já está nela
        // só devolve o mesmo (é o mais rápido).
        const torrent = await torrentNaConta(chave, hashDe(stream), []);
        if (!torrent) { rastro.push(`${q}: TorBox não aceitou o torrent`); return null; }
        const arquivo = escolherArquivo(torrent.files, { nome: (stream.behaviorHints || {}).filename, temporada: ehSerie ? temporada : 0, episodio: ehSerie ? episodio : 0, indice: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null });
        if (!arquivo) { rastro.push(`${q}: arquivo do vídeo não encontrado (${(torrent.files || []).length} arquivos)`); return null; }
        const { url, motivo } = await linkDoArquivo(chave, torrent.id, arquivo.id);
        if (!url) { rastro.push(`${q}: ${motivo}`); return null; }
        rastro.push(`${q}: link ok (${String(arquivo.short_name || arquivo.name || '').slice(-60)})`);
        // Confere o áudio de verdade antes de oferecer: o rótulo do torrent
        // engana (06/11/2026: Dexter T3E4 "dublado" tocou em italiano).
        const info = await require('./central/verificar-midia').faixasDeAudio(url, '', { timeout: 10000 }).catch(() => null);
        let faixa = null, midia = null, audioDireto = false;
        if (info && info.faixas && info.faixas.length) {
            const pt = info.faixas.find(f => /^pt|por/.test(f.idioma));
            const outras = info.faixas.filter(f => f.idioma && f.idioma !== 'und' && !/^pt|por/.test(f.idioma)).map(f => f.idioma);
            if (!pt && outras.length) { rastro.push(`${q}: sem áudio em português no arquivo (${[...new Set(outras)].join(', ')})`); return null; }
            const img = info.imagem || {};
            if (q !== '4K' && !hevcOk && /^(hevc|h265)$/.test(String(img.codec || ''))) { rastro.push(`${q}: vídeo H.265 (muitos aparelhos não mostram)`); return null; }
            if (img.dovi === 5) { rastro.push(`${q}: Dolby Vision perfil 5 (cores erradas fora de TV compatível)`); return null; }
            faixa = { indice: pt ? pt.ordem : 0, duracao: Number(info.duracao) || 0 };
            // Só dispensa a conversão quando o celular/navegador toca o áudio
            // como está: AAC/MP3 e o português é a faixa que o player vai usar.
            // 06/11/2026: MP4 4K com som Dolby (EAC3) abriu MUDO no S26 Ultra.
            const alvoAudio = pt || (info.faixas.length === 1 ? info.faixas[0] : null);
            audioDireto = Boolean(alvoAudio && /^(aac|mp3)$/.test(String(alvoAudio.codec || '')) && (info.faixas.length === 1 || alvoAudio.padrao));
            midia = { videoCodec: String(img.codec || ''), hdr: /smpte2084|arib-std-b67/.test(String(img.transferencia || '')), largura: Number(img.largura) || 0, altura: Number(img.altura) || 0 };
        }
        const mp4 = /\.(mp4|m4v)$/i.test(arquivo.short_name || arquivo.name || '') && audioDireto;
        return {
            url,
            audio: 'pt-BR',
            fonte: `TorBox · dublado ${q}${mp4 ? '' : ' (conversão)'}`,
            resolucao: q === '4K' ? '2160p' : q,
            quatroK: q === '4K',
            tamanho: Number(arquivo.size) || 0,
            ...(midia && midia.hdr ? { hdr: true } : {}),
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
            ...(faixa ? { faixa } : {}),
            videoCodec: (midia && midia.videoCodec) || (q === '4K' ? 'hevc' : 'h264'),
            validadeMs: VALIDADE,
        };
    };
    // O mesmo arquivo conferido serve por 2 h (motor 1, motor 2, outro aparelho).
    const tentar = async item => {
        const marca = `${hashDe(item.stream)}|${ehSerie ? `${temporada}x${episodio}` : 'filme'}|${hevcOk ? 'h' : 'a'}`;
        const ja = conferidos.get(marca);
        if (ja && ja.expira > Date.now()) return ja.valor ? { ...ja.valor } : null;
        // Dois pedidos ao mesmo tempo (4K e Full HD em paralelo, dois
        // aparelhos) conferem o mesmo arquivo uma vez só.
        if (emConferencia.has(marca)) { const v = await emConferencia.get(marca); return v ? { ...v } : null; }
        const trabalho = tentarNovo(item).catch(() => null);
        emConferencia.set(marca, trabalho);
        let valor;
        try { valor = await trabalho; } finally { emConferencia.delete(marca); }
        conferidos.set(marca, { valor, expira: Date.now() + (valor ? VALIDADE - 10 * 60 * 1000 : VALIDADE_VAZIO) });
        if (conferidos.size > 500) conferidos.delete(conferidos.keys().next().value);
        return valor ? { ...valor } : null;
    };
    const daQualidade = async q => {
        for (const item of escolhidos.filter(e => e.qualidade === q)) { const ok = await tentar(item); if (ok) return ok; }
        return null;
    };
    // Motor 1: a melhor qualidade que servir, uma de cada vez, e para no
    // primeiro acerto (não espera conferir 720p para entregar o 1080p).
    if (primeiro) {
        for (const q of qualidades) { const ok = await daQualidade(q); if (ok) return [ok]; }
        return [];
    }
    // Motor 2: todas as qualidades em paralelo.
    const saida = await Promise.all(qualidades.map(daQualidade));
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
        cache.set(marca, { valor, expira: Date.now() + (valor.length ? VALIDADE - 10 * 60 * 1000 : valor.semCandidatos ? VALIDADE_VAZIO : 3 * 60 * 1000) });
        return valor.map(d => ({ ...d }));
    } finally { emAndamento.delete(marca); }
}

// MOTOR 1: a melhor opção dublada que serve (4K quando pedido, senão Full HD),
// sem esperar as outras qualidades. null = não tem (vai para o motor 2).
async function resolverMelhor(tipo, tmdbId, temporada, episodio, { quer4k = false, so4k = false, hevcOk = false } = {}) {
    const chave = lerChave();
    const id = String(tmdbId || '').trim();
    if (!chave || !/^\d{1,10}$/.test(id) || (tipo !== 'movie' && tipo !== 'tv')) return null;
    const marca = (tipo === 'tv' ? `tv:${id}:${temporada || 1}:${episodio || 1}` : `movie:${id}`) + (so4k ? '|so4k' : quer4k ? '|4k' : '|hd') + (hevcOk || quer4k ? 'h' : 'a');
    const guardado = cache.get(marca);
    if (guardado && guardado.expira > Date.now()) return guardado.valor[0] ? { ...guardado.valor[0] } : null;
    if (emAndamento.has(marca)) { const v = await emAndamento.get(marca); return v[0] ? { ...v[0] } : null; }
    const trabalho = buscar(chave, tipo, id, temporada, episodio, [], { qualidades: so4k ? ['4K'] : quer4k ? ['4K', '1080p'] : ['1080p'], primeiro: true, hevcOk: hevcOk || quer4k }).catch(() => []);
    emAndamento.set(marca, trabalho);
    try {
        const valor = await trabalho;
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        // "Não tem nada dublado pronto" vale 20 min; "tinha, mas falhou ao
        // abrir" (limite da TorBox, rede) só 3 min — não prende no motor 2.
        cache.set(marca, { valor, expira: Date.now() + (valor.length ? VALIDADE - 10 * 60 * 1000 : valor.semCandidatos ? VALIDADE_VAZIO : 3 * 60 * 1000) });
        return valor[0] ? { ...valor[0] } : null;
    } finally { emAndamento.delete(marca); }
}

// ---------------------------------------------------------------- anime
// SÓ ANIME, SÓ LEGENDADO (pedido do Marlon, 07/11/2026: "deixando bem claro
// que é só no anime"). Filme, série, dorama e novela continuam só dublados.
// Procura o episódio em torrent com áudio original e LEGENDA EM PORTUGUÊS
// DENTRO do arquivo (lançamentos com várias legendas, ex.: Crunchyroll), já
// pronto na TorBox. A legenda vira legenda do player na conversão.
const LISTAS_ANIME = ['https://torrentio.strem.fun', 'https://cinema.debrid.in'];
const DICA_LEGENDA = /multi.?subs?|multiple.?sub|multisub|\bmulti\b|pt-?br|portugu|legendad|🇧🇷|🇵🇹|erai-raws|\bcr\b|crunchyroll|varyg/i;
function legendaPortuguesa(legendas) {
    // Só legenda em texto (ASS/SRT/WebVTT) vira legenda do player; imagem (PGS) não.
    const texto = l => /^(ass|ssa|subrip|srt|webvtt|mov_text|text)$/.test(String(l.codec || ''));
    const pt = l => /^(por|pt|pob|pt-br|ptbr)$/.test(String(l.idioma || '')) || /portugu|brazil|brasil|pt-?br/i.test(String(l.titulo || ''));
    const todas = (legendas || []).filter(l => texto(l) && pt(l));
    // Português do Brasil antes de Portugal; legenda completa antes de "sinais".
    return todas.sort((a, b) => (/brazil|brasil|pt-?br/i.test(b.titulo) - /brazil|brasil|pt-?br/i.test(a.titulo)) || (/sign|song|placa/i.test(a.titulo) - /sign|song|placa/i.test(b.titulo)))[0] || null;
}
// Legenda em português de FORA do arquivo (08/11/2026): muitos episódios
// legendados não trazem português embutido. O addon público OpenSubtitles do
// Stremio (sem conta, sem chave) tem PT-BR para boa parte dos animes; a
// legenda entra na conversão como se fosse do próprio arquivo.
const LEGENDAS_ONLINE = 'https://opensubtitles-v3.strem.io';
const legendasOnline = new Map();
function palavras(t) { return new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(p => p.length >= 2)); }
async function legendaOnlinePt(imdb, temporada, episodio, nomeArquivo = '') {
    if (!/^tt\d{5,10}$/.test(String(imdb || ''))) return null;
    const marca = `${imdb}:${temporada}:${episodio}`;
    let lista = legendasOnline.get(marca);
    if (!lista || lista.expira < Date.now()) {
        const r = await pedir(`${LEGENDAS_ONLINE}/subtitles/series/${marca}.json`, {}, 6000);
        const todas = (r.json && Array.isArray(r.json.subtitles)) ? r.json.subtitles : [];
        lista = { expira: Date.now() + (todas.length ? 12 : 1) * 60 * 60 * 1000, itens: todas };
        legendasOnline.set(marca, lista);
        if (legendasOnline.size > 500) legendasOnline.delete(legendasOnline.keys().next().value);
    }
    const doArquivo = palavras(nomeArquivo);
    const nota = l => {
        const nome = `${l.movieReleaseName || ''} ${l.subtitleFileName || ''}`;
        let n = l.lang === 'pob' ? 100 : 60;
        for (const p of palavras(nome)) if (doArquivo.has(p)) n += 3;
        // Mesma origem (WEB × BD) quase sempre tem o mesmo tempo de fala.
        const web = x => /web|cr\b|crunchyroll|netflix|amzn|nf\b/i.test(x), bd = x => /\bbd|blu-?ray|bdrip/i.test(x);
        if ((web(nome) && web(nomeArquivo)) || (bd(nome) && bd(nomeArquivo))) n += 15;
        return n;
    };
    const boas = lista.itens
        .filter(l => /^(pob|por)$/.test(String(l.lang || '')) && /^https:\/\/[a-z0-9.-]+\.strem\.io\//i.test(String(l.url || '')))
        .filter(l => !/forced|for[çc]ad|sign|placas/i.test(`${l.movieReleaseName || ''} ${l.subtitleFileName || ''}`))
        .sort((a, b) => nota(b) - nota(a));
    return boas.length ? { url: boas[0].url, nome: String(boas[0].movieReleaseName || '').slice(0, 120) } : null;
}
const ANIME_GB_LEVE = 2.5;   // GB por episódio
const ANIME_MBPS_MAX = 14;   // taxa máxima preferida (Mbps)
async function resolverAnimeLegendado(tmdbId, temporada, episodio, { hevcOk = false } = {}) {
    const chave = lerChave();
    const id = String(tmdbId || '').trim();
    if (!chave || !/^\d{1,10}$/.test(id) || !/^\d{1,3}$/.test(String(temporada)) || !/^\d{1,4}$/.test(String(episodio))) return null;
    const marca = `anime:${id}:${temporada}:${episodio}|${hevcOk ? 'h' : 'a'}`;
    const guardado = cache.get(marca);
    if (guardado && guardado.expira > Date.now()) return guardado.valor[0] ? { ...guardado.valor[0] } : null;
    if (emAndamento.has(marca)) { const v = await emAndamento.get(marca); return v[0] ? { ...v[0] } : null; }
    const trabalho = (async () => {
        const imdb = await require('./fenix-source').imdbDe(id, 'tv');
        if (!imdb) { const v = []; v.semCandidatos = true; return v; }
        const caminho = `series/${imdb}:${temporada}:${episodio}`;
        // Anime: as listas de anime + as aprovadas pelo caçador (várias têm anime).
        const respostas = await Promise.all([...new Set([...listasAnime(), ...listas()])].map(base => pedir(`${base}/stream/${caminho}.json`, {}, 4000)));
        const streams = juntar(respostas.map(r => (r.json && Array.isArray(r.json.streams) ? r.json.streams : [])))
            // "Legendado PT-BR" / Multi-Subs NÃO é dublado (antes era descartado).
            .filter(st => !/\b(?:cam|ts|hdcam|telesync)\b/i.test(rotuloDe(st)) && !(dubladoExplicito(rotuloDe(st)) && !/legendad|multi.?subs?|\bsubs?\b/i.test(rotuloDe(st))));
        const emCache = await emCacheNaTorBox(chave, streams.map(hashDe));
        const candidatos = streams.filter(st => emCache.has(hashDe(st)))
            .map(st => ({ st, r: rotuloDe(st) }))
            .map(x => ({ ...x, q: qualidade(x.r), hevc: ehHevc(x.r), dica: DICA_LEGENDA.test(x.r) }))
            .filter(x => (x.q === '1080p' || x.q === '720p') && (hevcOk || !x.hevc))
            .map(x => ({ ...x, gb: tamanhoGB(x.r) }))
            // Arquivo LEVE primeiro (08/11/2026): o remux de 5–6 GB por episódio
            // (~30 Mbps) convertia a 1,2x e não chegava no celular. Até 2,5 GB
            // por episódio é Full HD de sobra e flui pela rede de casa e móvel.
            .map(x => ({ ...x, leve: x.gb > 0 && x.gb <= ANIME_GB_LEVE ? 1 : x.gb === 0 ? 0.5 : 0 }))
            .sort((a, b) => (b.dica - a.dica) || (b.leve - a.leve) || ((b.q === '1080p') - (a.q === '1080p')) || (a.hevc - b.hevc) || (a.leve ? b.gb - a.gb : a.gb - b.gb))
            .slice(0, 3);
        if (!candidatos.length) { const v = []; v.semCandidatos = true; return v; }
        // Os 3 melhores conferidos AO MESMO TEMPO (não segura o anime quando
        // nenhum tem legenda em português); vale o primeiro da ordem que servir.
        const conferir = async ({ st, q }) => {
            const torrent = await torrentNaConta(chave, hashDe(st), []);
            if (!torrent) return null;
            const arquivo = escolherArquivo(torrent.files, { nome: (st.behaviorHints || {}).filename, temporada, episodio, indice: Number.isInteger(st.fileIdx) ? st.fileIdx : null });
            if (!arquivo) return null;
            const { url } = await linkDoArquivo(chave, torrent.id, arquivo.id);
            if (!url) return null;
            const info = await require('./central/verificar-midia').faixasDeAudio(url, '', { timeout: 8000 }).catch(() => null);
            if (!info || !info.faixas || !info.faixas.length) return null;
            const legenda = legendaPortuguesa(info.legendas);
            // Sem português no arquivo: legenda PT-BR de fora (OpenSubtitles).
            const externa = legenda ? null : await legendaOnlinePt(imdb, temporada, episodio, arquivo.short_name || arquivo.name || (st.behaviorHints || {}).filename || rotuloDe(st)).catch(() => null);
            if (!legenda && !externa) return null;
            const img = info.imagem || {};
            if (!hevcOk && /^(hevc|h265)$/.test(String(img.codec || ''))) return null;
            const audio = info.faixas.find(f => /^(jpn|ja)$/.test(f.idioma)) || info.faixas.find(f => f.padrao) || info.faixas[0];
            // Legenda de fora só serve com o som japonês (não para uma dublagem em inglês).
            if (externa && !/^(jpn|ja)$/.test(audio.idioma || '') && !(info.faixas.length === 1 && !/^(eng|en|por|pt)$/.test(audio.idioma || ''))) return null;
            const duracao = Number(info.duracao) || 0;
            const mbps = duracao > 0 && Number(arquivo.size) > 0 ? Math.round(Number(arquivo.size) * 8 / duracao / 1e5) / 10 : 0;
            return {
                mbps,
                url, audio: 'original', fonte: `TorBox · legendado ${q}${externa ? ' · legenda online' : ''}`, fonteId: 'torbox-legendado', resolucao: q,
                type: 'convertido', final: false, segredo: true, converter: true, efemera: true, anime: true,
                legendaPortugues: true, legendaEmbutida: true,
                faixa: { indice: audio.ordem, duracao: Number(info.duracao) || 0 }, legenda: legenda ? { indice: legenda.ordem } : null, legendaExterna: externa ? externa.url : '', externa: Boolean(externa),
                videoCodec: String(img.codec || ''), validadeMs: VALIDADE,
            };
        };
        const achados = await Promise.all(candidatos.map(c => conferir(c).catch(() => null)));
        // Vale o primeiro da ordem com taxa que a rede aguenta; se todos forem
        // pesados, o mais leve deles.
        const validos = achados.filter(Boolean);
        // Legenda do próprio arquivo antes da de fora (o tempo de fala é exato).
        const leve = x => !x.mbps || x.mbps <= ANIME_MBPS_MAX;
        const bom = validos.find(x => leve(x) && !x.externa) || validos.find(leve) || validos.sort((a, b) => a.mbps - b.mbps)[0];
        return bom ? [bom] : [];
    })().catch(() => []);
    emAndamento.set(marca, trabalho);
    try {
        const valor = await trabalho;
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        cache.set(marca, { valor, expira: Date.now() + (valor.length ? VALIDADE - 10 * 60 * 1000 : valor.semCandidatos ? VALIDADE_VAZIO : 3 * 60 * 1000) });
        return valor[0] ? { ...valor[0] } : null;
    } finally { emAndamento.delete(marca); }
}

async function resolver(tipo, tmdbId, temporada, episodio) {
    return (await resolverTodos(tipo, tmdbId, temporada, episodio))[0] || null;
}

module.exports = {
    legendaOnlinePt, listas, listasAnime, LISTAS_ANIME_FIXAS: () => LISTAS_ANIME, emCache: emCacheNaTorBox, rotuloDe, resolverAnimeLegendado, legendaPortuguesa, preludio, resolver, resolverMelhor, resolverTodos, ativa, lerChave, ehPortugues, dubladoExplicito, qualidade, ehHevc, escolherTorrents, escolherArquivo, tamanhoGB, hashDe, juntar, LISTAS };
