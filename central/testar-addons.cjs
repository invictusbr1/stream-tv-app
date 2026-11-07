'use strict';
// Confere a lista de addons do Stremio que o Marlon mandou (05/11/2026),
// agora com a TorBox: para cada addon lê o manifesto e pede os vídeos de 5
// títulos (os 3 problemáticos + 2 de referência). Conta quantos são dublados,
// quantos são link direto, quantos são torrent e — para os torrents — quantos
// a TorBox já tem prontos e que o Torrentio NÃO tinha (é isso que acrescenta).
//
// A chave da TorBox só vai para a própria TorBox. Nenhum addon recebe chave.

const { lerChave, ehPortugues } = require('./testar-torbox.cjs');

// 07/11/2026: addons brasileiros/dublados achados na lista da comunidade
// (stremio-addons.net / Stremio-Community/stremio-addons-list). A primeira
// lista (05/11) já foi conferida: só Torrentio e Absolute Cinema serviram.
const ADDONS = [
    'https://torrentio.strem.fun/brazuca/manifest.json',
    'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json',
    'https://94c8cb9f702d-brazuca-mp4.baby-beamup.club/manifest.json',
    'https://150203dd784e-cinetorrent-addon.baby-beamup.club/manifest.json',
    'https://e78422d452bf-rede-canais-addon.baby-beamup.club/manifest.json',
    'https://skyflix.onrender.com/manifest.json',
    'https://mycine.alwaysdata.net/manifest.json',
    'https://netcineaddon.onrender.com/manifest.json',
    'https://oneplay-addon-stremio.onrender.com/stremio_oneplay/manifest.json',
    'https://tugaplay.onrender.com/manifest.json',
];
const TORRENTIO_PT = 'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,bludv|language=portuguese|qualityfilter=scr,cam';
const TITULOS = [
    { nome: 'Curvas da Vida', tipo: 'movie', imdb: 'tt2083383', tmdb: '87825' },
    { nome: 'Os Suspeitos', tipo: 'movie', imdb: 'tt1392214', tmdb: '146233' },
    { nome: 'Pior Vizinho', tipo: 'movie', imdb: 'tt7405458', tmdb: '937278' },
    { nome: 'Oppenheimer', tipo: 'movie', imdb: 'tt15398776', tmdb: '872585' },
    { nome: 'Dexter T2E3', tipo: 'series', imdb: 'tt0773262:2:3', tmdb: '1405:2:3' },
];

async function pedir(url, ms = 20000) {
    const c = new AbortController();
    const r0 = setTimeout(() => c.abort(), ms);
    try {
        const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/json' } });
        const t = await r.text();
        let json = null; try { json = JSON.parse(t); } catch { /* não é JSON */ }
        return { status: r.status, json, texto: t.slice(0, 120) };
    } catch (e) { return { status: 0, json: null, texto: String(e.cause && e.cause.code || e.message) }; }
    finally { clearTimeout(r0); }
}

async function emCache(chave, hashes) {
    const achados = new Set();
    for (let i = 0; i < hashes.length; i += 50) {
        const lote = hashes.slice(i, i + 50);
        const c = new AbortController(); const r0 = setTimeout(() => c.abort(), 15000);
        try {
            const r = await fetch(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${lote.join(',')}&format=object`, { signal: c.signal, headers: { Authorization: `Bearer ${chave}` } });
            const d = (await r.json()).data;
            if (d && typeof d === 'object' && !Array.isArray(d)) Object.keys(d).forEach(h => achados.add(h.toLowerCase()));
            else if (Array.isArray(d)) d.forEach(x => x && x.hash && achados.add(String(x.hash).toLowerCase()));
        } catch { /* sem resposta */ } finally { clearTimeout(r0); }
    }
    return achados;
}

const hashDe = s => {
    if (s && /^[a-f0-9]{40}$/i.test(s.infoHash || '')) return s.infoHash.toLowerCase();
    const m = String((s && s.url) || '').match(/btih:([a-f0-9]{40})/i);
    return m ? m[1].toLowerCase() : '';
};
const rotulo = s => `${s.name || ''} ${s.title || ''} ${s.description || ''} ${(s.behaviorHints || {}).filename || ''}`;

async function principal() {
    const chave = lerChave();
    // Base de comparação: o que o app já pega hoje (Torrentio em português).
    const jaTemos = new Map();
    for (const t of TITULOS) {
        const r = await pedir(`${TORRENTIO_PT}/stream/${t.tipo}/${t.imdb}.json`);
        jaTemos.set(t.nome, new Set(((r.json && r.json.streams) || []).map(hashDe).filter(Boolean)));
    }
    const resultados = [];
    for (const endereco of ADDONS) {
        const host = new URL(endereco).hostname.replace(/^[a-f0-9]{12}-/, '');
        const base = endereco.replace(/\/manifest\.json$/, '');
        const m = await pedir(endereco);
        if (!m.json) { resultados.push({ nome: host, status: 'falhou', qualidade: '', detalhe: `manifesto não abriu (HTTP ${m.status} ${m.texto.replace(/\s+/g, ' ').slice(0, 60)})` }); console.log(host, 'sem manifesto'); continue; }
        const j = m.json;
        const recursos = (j.resources || []).map(x => typeof x === 'string' ? x : x && x.name).filter(Boolean);
        const prefixos = j.idPrefixes || (j.resources || []).flatMap(x => (x && x.idPrefixes) || []);
        const exigeConfig = Boolean(j.behaviorHints && j.behaviorHints.configurationRequired);
        const cab = `${j.name || host}: ${(j.types || []).join('/')}`;
        if (!recursos.includes('stream')) { resultados.push({ nome: host, status: 'sem dublado', qualidade: '', detalhe: `${cab} · só catálogo (lista de títulos), não entrega vídeo` }); console.log(host, 'só catálogo'); continue; }
        const usaTmdb = prefixos.length && !prefixos.includes('tt') && prefixos.some(p => /^tmdb/.test(p));
        const partes = []; let novosProntos = 0, ptTotal = 0, diretosPt = 0, total = 0;
        for (const t of TITULOS) {
            const id = usaTmdb ? `tmdb:${t.tmdb}` : t.imdb;
            const r = await pedir(`${base}/stream/${t.tipo}/${encodeURIComponent(id).replace(/%3A/g, ':')}.json`);
            const streams = (r.json && r.json.streams) || [];
            total += streams.length;
            const pt = streams.filter(s => ehPortugues(rotulo(s)));
            ptTotal += pt.length;
            const diretos = pt.filter(s => /^https?:\/\//.test(s.url || '') && !hashDe(s));
            diretosPt += diretos.length;
            const hashes = [...new Set(pt.map(hashDe).filter(Boolean))].filter(h => !jaTemos.get(t.nome).has(h));
            const prontos = chave && hashes.length ? (await emCache(chave, hashes)).size : 0;
            novosProntos += prontos;
            const hostsDiretos = [...new Set(diretos.map(s => { try { return new URL(s.url).hostname; } catch { return '?'; } }))].slice(0, 2).join(',');
            partes.push(`${t.nome}: ${r.status && !r.json ? 'HTTP ' + r.status : streams.length + ' vídeos'}${pt.length ? `, ${pt.length} PT` : ''}${diretos.length ? ` (${diretos.length} diretos ${hostsDiretos})` : ''}${hashes.length ? `, ${hashes.length} torrents novos/${prontos} prontos TorBox` : ''}`);
        }
        const status = novosProntos || diretosPt ? 'forte' : ptTotal ? 'dublado sem cache' : 'sem dublado';
        const linha = `${cab}${exigeConfig ? ' · exige configurar (conta)' : ''} · ${partes.join(' | ')}`;
        console.log(host, '→', linha);
        resultados.push({ nome: host, status, qualidade: '', detalhe: linha });
    }
    const resumo = [
        'Verde = traz algo dublado que o app ainda NÃO tem (link direto ou torrent novo já pronto na TorBox).',
        '"Exige configurar" = só funciona colando uma conta/chave dentro do addon — a chave NÃO foi enviada a nenhum addon.',
    ];
    console.log('RESULTADO:' + JSON.stringify({ resumo, resultados }));
}

if (require.main === module) principal().catch(e => { console.log('erro: ' + e.message); process.exitCode = 1; });
module.exports = { hashDe, ADDONS };
