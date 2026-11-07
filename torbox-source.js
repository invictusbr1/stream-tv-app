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
function escolherTorrents(streams, emCache, porQualidade = 1) {
    const pt = (streams || []).filter(s => s && hashDe(s) && emCache.has(hashDe(s)) && ehPortugues(rotuloDe(s)) && !/\b(?:cam|ts|hdcam|telesync)\b/i.test(rotuloDe(s)));
    const escolhidos = [];
    // 4K: quase sempre H.265 (é aceito só nele); Dolby Vision sem HDR de
    // reserva fica de fora já pelo rótulo (ver também a leitura do arquivo).
    const serve = (s, q) => q === '4K'
        ? !(/\b(?:dv|dovi|dolby.?vision)\b/i.test(rotuloDe(s)) && !/\bhdr/i.test(rotuloDe(s)))
        : !ehHevc(rotuloDe(s));
    for (const q of ['4K', '1080p', '720p']) {
        const daQualidade = pt.filter(s => qualidade(rotuloDe(s)) === q && serve(s, q))
            .sort((a, b) => (dubladoExplicito(rotuloDe(b)) - dubladoExplicito(rotuloDe(a))) || (tamanhoGB(rotuloDe(b)) - tamanhoGB(rotuloDe(a))));
        for (const stream of daQualidade.slice(0, porQualidade)) escolhidos.push({ stream, qualidade: q });
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
const PRELUDIO_VALIDADE = 10 * 60 * 1000;
let limpezaAgendada = false;
function manterConta(chave) {
    if (limpezaAgendada || Date.now() - ultimaLimpeza < 60 * 60 * 1000) return;
    limpezaAgendada = true;
    setImmediate(() => { minhaLista(chave).then(lista => limparConta(chave, lista)).catch(() => {}).finally(() => { limpezaAgendada = false; }); });
}

async function buscar(chave, tipo, tmdbId, temporada, episodio, rastro = [], { qualidades = ['4K', '1080p', '720p'], primeiro = false } = {}) {
    const ehSerie = tipo === 'tv';
    const imdb = await require('./fenix-source').imdbDe(tmdbId, ehSerie ? 'tv' : 'movie');
    if (!imdb) { rastro.push('sem código IMDb no TMDB'); return []; }
    const caminho = ehSerie ? `series/${imdb}:${temporada || 1}:${episodio || 1}` : `movie/${imdb}`;
    const guardado = preludios.get(caminho);
    if (guardado && guardado.expira > Date.now()) return depoisDoPreludio(chave, guardado.valor, { ehSerie, temporada, episodio, rastro, qualidades, primeiro });
    // Lista lenta não segura as outras: 4 s cada, todas ao mesmo tempo.
    const respostas = await Promise.all(LISTAS.map(base => pedir(`${base}/stream/${caminho}.json`, {}, 4000)));
    const streams = juntar(respostas.map(r => (r.json && Array.isArray(r.json.streams) ? r.json.streams : [])));
    const hashes = streams.filter(s => ehPortugues(rotuloDe(s))).map(hashDe);
    const emCache = await emCacheNaTorBox(chave, hashes);
    // Até 3 reservas por qualidade: se o arquivo do primeiro não tiver áudio
    // em português (conferido abaixo), tenta o seguinte.
    const escolhidos = escolherTorrents(streams, emCache, 3);
    preludios.set(caminho, { valor: { escolhidos, imdb }, expira: Date.now() + PRELUDIO_VALIDADE });
    if (preludios.size > 300) preludios.delete(preludios.keys().next().value);
    rastro.push(`${imdb}: listas ${respostas.map(r => r.status + '/' + ((r.json && r.json.streams) || []).length).join(' ')} · ${streams.length} torrents · ${hashes.length} PT · ${emCache.size} prontos · escolhidos ${escolhidos.map(e => e.qualidade).join('+') || 'nenhum'}`);
    return depoisDoPreludio(chave, { escolhidos, imdb }, { ehSerie, temporada, episodio, rastro, qualidades, primeiro });
}

async function depoisDoPreludio(chave, { escolhidos }, { ehSerie, temporada, episodio, rastro, qualidades, primeiro }) {
    if (!escolhidos.length) return [];
    manterConta(chave);
    const tentarNovo = async ({ stream, qualidade: q }) => {
        // Sem ler a conta inteira: criar de novo um torrent que já está nela
        // só devolve o mesmo (é o mais rápido).
        const torrent = await torrentNaConta(chave, hashDe(stream), []);
        if (!torrent) { rastro.push(`${q}: TorBox não aceitou o torrent`); return null; }
        const arquivo = escolherArquivo(torrent.files, { nome: (stream.behaviorHints || {}).filename, temporada: ehSerie ? temporada : 0, episodio: ehSerie ? episodio : 0 });
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
            if (q !== '4K' && /^(hevc|h265)$/.test(String(img.codec || ''))) { rastro.push(`${q}: vídeo H.265 (muitos aparelhos não mostram)`); return null; }
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
        const marca = `${hashDe(item.stream)}|${ehSerie ? `${temporada}x${episodio}` : 'filme'}`;
        const ja = conferidos.get(marca);
        if (ja && ja.expira > Date.now()) return ja.valor ? { ...ja.valor } : null;
        const valor = await tentarNovo(item);
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
        cache.set(marca, { valor, expira: Date.now() + (valor.length ? VALIDADE - 10 * 60 * 1000 : VALIDADE_VAZIO) });
        return valor.map(d => ({ ...d }));
    } finally { emAndamento.delete(marca); }
}

// MOTOR 1: a melhor opção dublada que serve (4K quando pedido, senão Full HD),
// sem esperar as outras qualidades. null = não tem (vai para o motor 2).
async function resolverMelhor(tipo, tmdbId, temporada, episodio, { quer4k = false } = {}) {
    const chave = lerChave();
    const id = String(tmdbId || '').trim();
    if (!chave || !/^\d{1,10}$/.test(id) || (tipo !== 'movie' && tipo !== 'tv')) return null;
    const marca = (tipo === 'tv' ? `tv:${id}:${temporada || 1}:${episodio || 1}` : `movie:${id}`) + (quer4k ? '|4k' : '|hd');
    const guardado = cache.get(marca);
    if (guardado && guardado.expira > Date.now()) return guardado.valor[0] ? { ...guardado.valor[0] } : null;
    if (emAndamento.has(marca)) { const v = await emAndamento.get(marca); return v[0] ? { ...v[0] } : null; }
    const trabalho = buscar(chave, tipo, id, temporada, episodio, [], { qualidades: quer4k ? ['4K', '1080p'] : ['1080p'], primeiro: true }).catch(() => []);
    emAndamento.set(marca, trabalho);
    try {
        const valor = await trabalho;
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        cache.set(marca, { valor, expira: Date.now() + (valor.length ? VALIDADE - 10 * 60 * 1000 : VALIDADE_VAZIO) });
        return valor[0] ? { ...valor[0] } : null;
    } finally { emAndamento.delete(marca); }
}

async function resolver(tipo, tmdbId, temporada, episodio) {
    return (await resolverTodos(tipo, tmdbId, temporada, episodio))[0] || null;
}

module.exports = { resolver, resolverMelhor, resolverTodos, ativa, lerChave, ehPortugues, dubladoExplicito, qualidade, ehHevc, escolherTorrents, escolherArquivo, tamanhoGB, hashDe, juntar, LISTAS };
