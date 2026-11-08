'use strict';
// Teste da TorBox (sem gastar downloads do plano).
//
// Para cada título da lista: pega no Torrentio (público) os torrents com áudio
// em português e pergunta à TorBox quais já estão no cache dela — os que estão
// no cache abrem na hora. A consulta de cache NÃO conta como download.
//
// A chave fica em CHAVE-TORBOX.local.txt (fora do GitHub e do envio para a
// Oracle). Ela é lida aqui e só vai no cabeçalho do pedido à TorBox: nunca é
// escrita no registro nem na tela.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const ARQUIVO_CHAVE = path.join(RAIZ, 'CHAVE-TORBOX.local.txt');
const API = 'https://api.torbox.app/v1/api';
const TORRENTIO = 'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,bludv|language=portuguese|qualityfilter=scr,cam';

const TITULOS = [
    { nome: 'O Pior Vizinho do Mundo', tipo: 'movie', id: 'tt7405458' },
    { nome: 'Curvas da Vida', tipo: 'movie', id: 'tt2083383' },
    { nome: 'Os Suspeitos (2013)', tipo: 'movie', id: 'tt1392214' },
    { nome: 'Deadpool & Wolverine', tipo: 'movie', id: 'tt6263850' },
    { nome: 'Duna: Parte Dois', tipo: 'movie', id: 'tt15239678' },
    { nome: 'Oppenheimer', tipo: 'movie', id: 'tt15398776' },
    { nome: 'Divertida Mente 2', tipo: 'movie', id: 'tt22022452' },
    { nome: 'Moana 2', tipo: 'movie', id: 'tt13622970' },
    { nome: 'Interestelar', tipo: 'movie', id: 'tt0816692' },
    { nome: 'Dexter T2E3', tipo: 'series', id: 'tt0773262:2:3' },
    { nome: 'Breaking Bad T1E1', tipo: 'series', id: 'tt0903747:1:1' },
    { nome: 'The Last of Us T1E1', tipo: 'series', id: 'tt3581920:1:1' },
    { nome: 'Wandinha T1E1', tipo: 'series', id: 'tt13443470:1:1' },
];

function lerChave(arquivo = ARQUIVO_CHAVE) {
    let texto = '';
    try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return ''; }
    const linha = texto.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
    return /^[A-Za-z0-9-]{20,80}$/.test(linha) ? linha : '';
}

// Áudio em português declarado no torrent (bandeira do Brasil, "dual", "dublado"...).
function ehPortugues(rotulo) {
    return /🇧🇷|\bdual\b|dublad|nacional|pt[-. ]?br|portugu/i.test(String(rotulo || ''));
}
function qualidade(rotulo) {
    const t = String(rotulo || '');
    if (/2160p|\b4k\b|uhd/i.test(t)) return '4K';
    const m = t.match(/\b(1080|720|480)p\b/i);
    return m ? m[1] + 'p' : '?';
}
const PESO = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, '?': 0 };
function tamanho(rotulo) { const m = String(rotulo || '').match(/💾\s*([\d.,]+\s*[GM]B)/i); return m ? m[1].replace(',', '.') : ''; }
function origem(rotulo) { const m = String(rotulo || '').match(/⚙️\s*([^\n]+)/); return m ? m[1].trim().slice(0, 30) : ''; }

async function pedir(url, opcoes = {}, ms = 15000) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ms);
    try {
        const r = await fetch(url, { ...opcoes, signal: controle.signal, headers: { 'User-Agent': 'ConectaTV/teste', Accept: 'application/json', ...(opcoes.headers || {}) } });
        const texto = await r.text();
        let json = null; try { json = JSON.parse(texto); } catch { /* não é JSON */ }
        return { status: r.status, json };
    } finally { clearTimeout(relogio); }
}

async function emCache(chave, hashes) {
    const achados = new Set();
    for (let i = 0; i < hashes.length; i += 50) {
        const lote = hashes.slice(i, i + 50);
        const r = await pedir(`${API}/torrents/checkcached?hash=${lote.join(',')}&format=object`, { headers: { Authorization: `Bearer ${chave}` } });
        if (r.status === 401 || r.status === 403) throw new Error('a TorBox recusou a chave (confira se colou certo)');
        const dados = r.json && r.json.data;
        if (dados && typeof dados === 'object' && !Array.isArray(dados)) for (const h of Object.keys(dados)) achados.add(h.toLowerCase());
        else if (Array.isArray(dados)) for (const d of dados) if (d && d.hash) achados.add(String(d.hash).toLowerCase());
    }
    return achados;
}

async function principal() {
    const chave = lerChave();
    if (!chave) { console.log('Não achei a chave em CHAVE-TORBOX.local.txt (cole na linha de baixo dos comentários e salve).'); process.exitCode = 2; return; }
    const resumo = [];
    try {
        const eu = await pedir(`${API}/user/me`, { headers: { Authorization: `Bearer ${chave}` } });
        if (eu.status === 401 || eu.status === 403) throw new Error('a TorBox recusou a chave');
        const d = (eu.json && eu.json.data) || {};
        const planos = { 0: 'Gratuito', 1: 'Essential', 2: 'Pro', 3: 'Standard' };
        resumo.push(`Conta TorBox OK · plano: ${planos[d.plan] || d.plan || '?'}${d.premium_expires_at ? ' · vale até ' + new Date(d.premium_expires_at).toLocaleString('pt-BR') : ''}`);
    } catch (erro) { console.log('Erro na conta: ' + erro.message); console.log('RESULTADO:' + JSON.stringify({ resumo: ['Erro na conta: ' + erro.message], resultados: [] })); process.exitCode = 3; return; }

    const resultados = [];
    let comDubladoNaHora = 0;
    for (const t of TITULOS) {
        let streams = [];
        try { const r = await pedir(`${TORRENTIO}/stream/${t.tipo}/${t.id}.json`); streams = (r.json && r.json.streams) || []; } catch { /* sem resposta */ }
        const pt = streams.filter(s => s.infoHash && ehPortugues(`${s.name || ''} ${s.title || ''}`));
        let cache = new Set();
        try { cache = await emCache(chave, [...new Set(pt.map(s => s.infoHash.toLowerCase()))]); }
        catch (erro) { resumo.push('Erro na TorBox: ' + erro.message); break; }
        const prontos = pt.filter(s => cache.has(s.infoHash.toLowerCase()))
            .sort((a, b) => PESO[qualidade(`${b.name} ${b.title}`)] - PESO[qualidade(`${a.name} ${a.title}`)]);
        const melhor = prontos[0];
        if (melhor) comDubladoNaHora++;
        const rotulo = melhor ? `${melhor.name || ''} ${melhor.title || ''}` : '';
        resultados.push({
            nome: t.nome,
            status: melhor ? 'forte' : pt.length ? 'dublado sem cache' : streams.length ? 'sem dublado' : 'nenhum torrent',
            qualidade: melhor ? qualidade(rotulo) : '',
            detalhe: `${streams.length} torrents · ${pt.length} dublados · ${prontos.length} abrem na hora` + (melhor ? ` · melhor: ${qualidade(rotulo)} ${tamanho(rotulo)} ${origem(rotulo)}`.trimEnd() : ''),
        });
        console.log(`${t.nome}: ${resultados[resultados.length - 1].detalhe}`);
    }
    resumo.push(`${comDubladoNaHora} de ${TITULOS.length} títulos têm versão DUBLADA que abre na hora (verde na tabela).`);
    resumo.push('"dublado sem cache" = existe dublado, mas a TorBox teria que baixar antes (demora). Nenhum download do plano foi gasto neste teste.');
    resumo.forEach(l => console.log(l));
    console.log('RESULTADO:' + JSON.stringify({ resumo, resultados }));
}

// ------------------------------------------------------------ modo --tocar
// Pega de verdade 3 títulos que estão no cache (gasta 3 downloads do plano),
// lê o arquivo com o ffprobe (formato, imagem, faixas de áudio) e mede a
// velocidade baixando um pedaço. Depois apaga o torrent da conta para não
// ocupar vaga. O link de download tem a chave dentro: nunca é mostrado.
const PARA_TOCAR = ['tt7405458', 'tt15398776', 'tt0773262:2:3'];
const VIDEO = /\.(mkv|mp4|m4v|avi|ts|webm)$/i;

function escolherArquivo(arquivos, nomeEsperado) {
    const videos = (arquivos || []).filter(a => VIDEO.test(a.name || a.short_name || ''));
    if (nomeEsperado) {
        const alvo = String(nomeEsperado).toLowerCase();
        const achado = videos.find(a => String(a.short_name || a.name || '').toLowerCase().endsWith(alvo));
        if (achado) return achado;
    }
    return videos.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0] || null;
}

// O que cada aparelho costuma conseguir tocar (player do app = ExoPlayer/Media3).
function veredito(m) {
    const avisos = [];
    const v = (m.imagem && m.imagem.codec) || '';
    if (v === 'hevc') avisos.push('vídeo H.265: celular/TV dos últimos ~6 anos tocam; aparelho antigo pode não');
    else if (v && v !== 'h264') avisos.push(`vídeo ${v}: pode não tocar em aparelho antigo`);
    if (/10le|p010/i.test((m.imagem && m.imagem.pixels) || '')) avisos.push('10 bits/HDR: aparelho fraco pode engasgar');
    const pt = m.faixas.find(f => /^pt|por/.test(f.idioma));
    const codecPt = pt ? pt.codec : (m.faixas[0] && m.faixas[0].codec) || '';
    if (/dts|truehd/.test(codecPt)) avisos.push(`áudio ${codecPt}: celular NÃO toca (precisa converter); TV só com receiver`);
    else if (/eac3|ac3/.test(codecPt)) avisos.push(`áudio ${codecPt} (Dolby): TV e TV Box tocam; celular depende do aparelho`);
    if (!pt) avisos.push('nenhuma faixa marcada como português no arquivo (pode estar "und")');
    return avisos;
}

async function medirVelocidade(url, bytes = 16 * 1024 * 1024, ms = 30000) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ms);
    const inicio = Date.now();
    let total = 0;
    try {
        const r = await fetch(url, { signal: controle.signal, headers: { Range: `bytes=0-${bytes - 1}`, 'User-Agent': 'ConectaTV/teste' } });
        const primeiro = Date.now() - inicio;
        const leitor = r.body.getReader();
        for (;;) { const { done, value } = await leitor.read(); if (done) break; total += value.length; if (total >= bytes) { controle.abort(); break; } }
        const seg = (Date.now() - inicio) / 1000;
        return { inicioMs: primeiro, mbps: Math.round((total * 8 / 1e6 / seg) * 10) / 10, aceitaPulo: r.status === 206 };
    } catch { const seg = (Date.now() - inicio) / 1000; return { inicioMs: 0, mbps: total ? Math.round((total * 8 / 1e6 / seg) * 10) / 10 : 0, aceitaPulo: false }; }
    finally { clearTimeout(relogio); }
}

async function tocar() {
    const chave = lerChave();
    if (!chave) { console.log('Não achei a chave em CHAVE-TORBOX.local.txt.'); process.exitCode = 2; return; }
    const auth = { Authorization: `Bearer ${chave}` };
    const midia = require('./verificar-midia');
    const resumo = []; const resultados = [];
    const ffprobeOk = Boolean((await midia.garantirFerramentas()).ffprobe);
    if (!ffprobeOk) resumo.push('Sem ffprobe neste PC: não deu para ler formato/áudio (só velocidade).');
    for (const id of PARA_TOCAR) {
        const t = TITULOS.find(x => x.id === id);
        const linha = { nome: t.nome, status: 'falhou', qualidade: '', detalhe: '' };
        let torrentId = null;
        try {
            const r = await pedir(`${TORRENTIO}/stream/${t.tipo}/${t.id}.json`);
            const pt = ((r.json && r.json.streams) || []).filter(s => s.infoHash && ehPortugues(`${s.name || ''} ${s.title || ''}`));
            const cache = await emCache(chave, [...new Set(pt.map(s => s.infoHash.toLowerCase()))]);
            const melhor = pt.filter(s => cache.has(s.infoHash.toLowerCase()))
                .sort((a, b) => PESO[qualidade(`${b.name} ${b.title}`)] - PESO[qualidade(`${a.name} ${a.title}`)])[0];
            if (!melhor) throw new Error('nenhum dublado no cache agora');
            linha.qualidade = qualidade(`${melhor.name} ${melhor.title}`);
            const t0 = Date.now();
            const form = new FormData();
            form.append('magnet', `magnet:?xt=urn:btih:${melhor.infoHash}`);
            const criado = await pedir(`${API}/torrents/createtorrent`, { method: 'POST', body: form, headers: auth }, 30000);
            torrentId = criado.json && criado.json.data && criado.json.data.torrent_id;
            if (!torrentId) throw new Error('a TorBox não aceitou o torrent' + (criado.json && criado.json.detail ? ` (${String(criado.json.detail).slice(0, 80)})` : ''));
            let arquivos = [];
            for (let i = 0; i < 10 && !arquivos.length; i++) {
                const lista = await pedir(`${API}/torrents/mylist?id=${torrentId}&bypass_cache=true`, { headers: auth });
                arquivos = (lista.json && lista.json.data && lista.json.data.files) || [];
                if (!arquivos.length) await new Promise(ok => setTimeout(ok, 1500));
            }
            const arquivo = escolherArquivo(arquivos, melhor.behaviorHints && melhor.behaviorHints.filename);
            if (!arquivo) throw new Error('não achei arquivo de vídeo no torrent');
            const dl = await pedir(`${API}/torrents/requestdl?token=${encodeURIComponent(chave)}&torrent_id=${torrentId}&file_id=${arquivo.id}&redirect=false`, { headers: auth }, 30000);
            const link = dl.json && dl.json.data;
            if (typeof link !== 'string' || !/^https:\/\//.test(link)) throw new Error('a TorBox não entregou o link');
            const prontoMs = Date.now() - t0;
            const vel = await medirVelocidade(link);
            const info = ffprobeOk ? await midia.faixasDeAudio(link, '', { timeout: 60000 }) : null;
            const partes = [`pronto em ${(prontoMs / 1000).toFixed(1)} s`, `${vel.mbps} Mbit/s`, vel.aceitaPulo ? 'aceita avançar' : 'NÃO aceita avançar'];
            if (info) {
                partes.push(`${info.container.split(',')[0]} · ${info.imagem.largura}x${info.imagem.altura} ${info.imagem.codec}${/10le|p010/.test(info.imagem.pixels) ? ' 10bit' : ''}`);
                partes.push('áudio: ' + info.faixas.map(f => `${f.idioma || 'und'}/${f.codec}${f.padrao ? '*' : ''}`).join(', '));
                if (info.duracao) partes.push(`${Math.round(info.duracao / 60)} min`);
                const avisos = veredito(info);
                if (avisos.length) partes.push('⚠ ' + avisos.join('; '));
                linha.status = avisos.some(a => /NÃO toca|nenhuma faixa/.test(a)) ? 'dublado sem cache' : 'forte';
            } else { linha.status = vel.mbps > 0 ? 'forte' : 'falhou'; if (ffprobeOk) partes.push('ffprobe não conseguiu ler'); }
            linha.detalhe = partes.join(' · ');
        } catch (erro) { linha.detalhe = erro.message; }
        finally {
            if (torrentId) {
                try { await pedir(`${API}/torrents/controltorrent`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' }) }); } catch { /* fica na conta */ }
            }
        }
        console.log(`${linha.nome}: ${linha.detalhe}`);
        resultados.push(linha);
    }
    resumo.push('Verde = toca bem. Amarelo = abriu, mas tem áudio que o celular não toca ou falta faixa PT marcada. "*" = faixa padrão do arquivo.');
    resumo.push('Foram usados até 3 downloads do plano; os torrents já foram apagados da conta.');
    resumo.forEach(l => console.log(l));
    console.log('RESULTADO:' + JSON.stringify({ resumo, resultados }));
}

// ------------------------------------------------------------ modo --fonte
// Roda a FONTE do app (torbox-source.js) como o servidor roda, para 4 títulos.
async function fonte() {
    const tb = require('../torbox-source');
    if (!tb.ativa()) { console.log('Não achei a chave em CHAVE-TORBOX.local.txt.'); process.exitCode = 2; return; }
    const midia = require('./verificar-midia');
    const alvos = [
        { nome: 'O Pior Vizinho do Mundo', tipo: 'movie', id: '937278' },
        { nome: 'Os Suspeitos (2013)', tipo: 'movie', id: '146233' },
        { nome: 'Curvas da Vida', tipo: 'movie', id: '87825' },
        { nome: 'Dexter T2E3', tipo: 'tv', id: '1405', t: 2, e: 3 },
    ];
    const resultados = [];
    for (const a of alvos) {
        const inicio = Date.now();
        const rastro = [];
        const lista = await tb.resolverTodos(a.tipo, a.id, a.t, a.e, rastro);
        const ms = Date.now() - inicio;
        const partes = [`${(ms / 1000).toFixed(1)} s`, `${lista.length} opção(ões)`, ...rastro];
        for (const d of lista) {
            const info = await midia.faixasDeAudio(d.url, '', { timeout: 30000 }).catch(() => null);
            const faixas = info ? info.faixas.map(f => `${f.idioma || 'und'}/${f.codec}${f.padrao ? '*' : ''}`).join(', ') : '';
            partes.push(`${d.fonte}${d.dubladoConfiavel ? '' : ' (só "DUAL")'} → ${info ? `${info.imagem.largura}x${info.imagem.altura} ${info.imagem.codec}, áudio ${faixas || 'nenhum'}, ${Math.round(info.duracao / 60)} min` : 'não li o arquivo'}`);
        }
        console.log(`${a.nome}: ${partes.join(' · ')}`);
        resultados.push({ nome: a.nome, status: lista.length ? 'forte' : 'sem dublado', qualidade: lista[0] ? lista[0].resolucao : '', detalhe: partes.join(' · ') });
    }
    const resumo = ['Teste da fonte TorBox exatamente como o servidor vai usar. Os links não são mostrados.'];
    console.log('RESULTADO:' + JSON.stringify({ resumo, resultados }));
}

// ------------------------------------------------------------ modo --link
// O link que a TorBox devolve traz a chave dentro. Aqui vemos ONDE ela está
// (sem mostrar: aparece como ***) e se o arquivo abre sem ela. Gasta 1 download.
async function link() {
    const chave = lerChave();
    if (!chave) { console.log('Sem chave.'); return; }
    const auth = { Authorization: `Bearer ${chave}` };
    const linhas = [];
    let torrentId = null;
    try {
        const r = await pedir(`${TORRENTIO}/stream/series/tt0773262:2:3.json`);
        const pt = ((r.json && r.json.streams) || []).filter(s => s.infoHash && ehPortugues(`${s.name || ''} ${s.title || ''}`));
        const cache = await emCache(chave, pt.map(s => s.infoHash.toLowerCase()));
        const s = pt.find(x => cache.has(x.infoHash.toLowerCase()));
        if (!s) throw new Error('Dexter não está pronto agora');
        const form = new FormData(); form.append('magnet', `magnet:?xt=urn:btih:${s.infoHash}`);
        const c = await pedir(`${API}/torrents/createtorrent`, { method: 'POST', body: form, headers: auth }, 30000);
        torrentId = c.json && c.json.data && c.json.data.torrent_id;
        let arquivos = [];
        for (let i = 0; i < 8 && !arquivos.length; i++) { const l = await pedir(`${API}/torrents/mylist?id=${torrentId}&bypass_cache=true`, { headers: auth }); arquivos = (l.json && l.json.data && l.json.data.files) || []; if (!arquivos.length) await new Promise(ok => setTimeout(ok, 1500)); }
        const arq = arquivos.sort((a, b) => b.size - a.size)[0];
        const dl = await pedir(`${API}/torrents/requestdl?token=${encodeURIComponent(chave)}&torrent_id=${torrentId}&file_id=${arq.id}&redirect=false`, { headers: auth }, 30000);
        const url = new URL(dl.json.data);
        const mascara = t => String(t).split(chave).join('***').split(encodeURIComponent(chave)).join('***');
        linhas.push(`host: ${url.hostname}`);
        linhas.push(`caminho: ${mascara(url.pathname).replace(/[A-Za-z0-9_-]{25,}/g, m => m === '***' ? m : '<código>')}`);
        linhas.push(`parâmetros: ${[...url.searchParams.keys()].map(k => k + (url.searchParams.get(k).includes(chave) ? '=***' : '=…')).join(' & ') || 'nenhum'}`);
        const testar = async (rotulo, endereco) => {
            try {
                const resp = await fetch(endereco, { headers: { Range: 'bytes=0-1023' }, redirect: 'manual' });
                linhas.push(`${rotulo}: HTTP ${resp.status}${resp.headers.get('location') ? ' (redireciona para ' + new URL(resp.headers.get('location'), endereco).hostname + (resp.headers.get('location').includes(chave) ? ', com a chave' : ', sem a chave') + ')' : ''}`);
                try { resp.body && resp.body.cancel(); } catch { /* ok */ }
            } catch (e) { linhas.push(`${rotulo}: erro ${e.message}`); }
        };
        await testar('link original', url.href);
        for (const k of [...url.searchParams.keys()].filter(k => url.searchParams.get(k).includes(chave))) {
            const sem = new URL(url.href); sem.searchParams.delete(k); await testar(`sem o parâmetro "${k}"`, sem.href);
        }
        // Pedido com redirect=true: a TorBox responde com o endereço final do arquivo.
        const red = await fetch(`${API}/torrents/requestdl?token=${encodeURIComponent(chave)}&torrent_id=${torrentId}&file_id=${arq.id}&redirect=true`, { redirect: 'manual' });
        const loc = red.headers.get('location') || '';
        linhas.push(`redirect=true: HTTP ${red.status}${loc ? ' → ' + new URL(loc).hostname + (loc.includes(chave) ? ' (com a chave)' : ' (sem a chave)') : ''}`);
    } catch (e) { linhas.push('erro: ' + e.message); }
    finally { if (torrentId) await pedir(`${API}/torrents/controltorrent`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' }) }).catch(() => {}); }
    linhas.forEach(l => console.log(l.split(lerChave()).join('***')));
    console.log('RESULTADO:' + JSON.stringify({ resumo: ['Onde a chave aparece no link da TorBox (mostrada como ***).'], resultados: linhas.map(l => ({ nome: l.split(':')[0], status: /HTTP 20[06]/.test(l) ? 'forte' : '', qualidade: '', detalhe: l.split(lerChave()).join('***') })) }));
}

// ------------------------------------------------------------ modo --slots
// Antes de assinar o Essencial (3 slots): os filmes abertos ficam na conta e
// podem ocupar slot. Aqui: abre 1 episódio, olha como ele aparece na conta,
// APAGA da conta e confere se o link continua tocando (no começo e no meio).
// Se continuar, o app pode liberar o slot logo depois de pegar o link.
async function slots() {
    const chave = lerChave();
    if (!chave) { console.log('Sem chave.'); return; }
    const auth = { Authorization: `Bearer ${chave}` };
    const linhas = [];
    const pedaco = async (url, inicio) => {
        try {
            const r = await fetch(url, { headers: { Range: `bytes=${inicio}-${inicio + 1023}` } });
            try { r.body && await r.body.cancel(); } catch { /* ok */ }
            return r.status;
        } catch (e) { return 'erro ' + (e.cause && e.cause.code || e.message); }
    };
    let torrentId = null, apagado = false;
    try {
        const eu = await pedir(`${API}/user/me`, { headers: auth });
        const d = (eu.json && eu.json.data) || {};
        const campos = Object.keys(d).filter(k => /slot|active|concurrent|limit/i.test(k)).map(k => `${k}=${typeof d[k] === 'object' ? JSON.stringify(d[k]).slice(0, 60) : d[k]}`);
        linhas.push({ nome: 'Conta', detalhe: `plano ${d.plan} · ${campos.join(' · ') || 'sem campos de slot na resposta'}` });
        const antes = await pedir(`${API}/torrents/mylist?bypass_cache=true`, { headers: auth });
        const listaAntes = Array.isArray(antes.json && antes.json.data) ? antes.json.data : [];
        linhas.push({ nome: 'Na conta antes', detalhe: `${listaAntes.length} torrents · ativos: ${listaAntes.filter(t => t.active).length} · estados: ${[...new Set(listaAntes.map(t => t.download_state))].join(', ') || '-'}` });

        const r = await pedir(`${TORRENTIO}/stream/series/tt0773262:2:3.json`);
        const pt = ((r.json && r.json.streams) || []).filter(x => x.infoHash && ehPortugues(`${x.name || ''} ${x.title || ''}`));
        const cache = await emCache(chave, pt.map(x => x.infoHash.toLowerCase()));
        const st = pt.find(x => cache.has(x.infoHash.toLowerCase()));
        if (!st) throw new Error('Dexter T2E3 não está pronto agora');
        const form = new FormData(); form.append('magnet', `magnet:?xt=urn:btih:${st.infoHash}`);
        const c = await pedir(`${API}/torrents/createtorrent`, { method: 'POST', body: form, headers: auth }, 30000);
        torrentId = c.json && c.json.data && c.json.data.torrent_id;
        if (!torrentId) throw new Error('a TorBox não aceitou o torrent' + (c.json && c.json.detail ? ` (${String(c.json.detail).slice(0, 100)})` : ''));
        let t = null;
        for (let i = 0; i < 8; i++) { const l = await pedir(`${API}/torrents/mylist?id=${torrentId}&bypass_cache=true`, { headers: auth }); t = l.json && l.json.data; if (t && Array.isArray(t.files) && t.files.length) break; await new Promise(ok => setTimeout(ok, 1500)); }
        if (!t || !t.files || !t.files.length) throw new Error('sem arquivos no torrent');
        linhas.push({ nome: 'Depois de abrir', detalhe: `estado "${t.download_state}" · ativo: ${t.active} · terminado: ${t.download_finished} · semeando: ${t.seeding !== undefined ? t.seeding : '?'}` });
        const arq = t.files.sort((a, b) => b.size - a.size)[0];
        const dl = await pedir(`${API}/torrents/requestdl?token=${encodeURIComponent(chave)}&torrent_id=${torrentId}&file_id=${arq.id}&redirect=false`, { headers: auth }, 30000);
        const link = dl.json && dl.json.data;
        if (typeof link !== 'string') throw new Error('sem link');
        const meio = Math.max(0, Math.floor((Number(arq.size) || 0) / 2));
        linhas.push({ nome: 'Link antes de apagar', detalhe: `começo HTTP ${await pedaco(link, 0)} · meio HTTP ${await pedaco(link, meio)}` });

        const del = await pedir(`${API}/torrents/controltorrent`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' }) });
        apagado = Boolean(del.json && del.json.success !== false);
        linhas.push({ nome: 'Apagar da conta', detalhe: apagado ? 'apagado' : `não apagou (HTTP ${del.status})` });
        for (const espera of [5, 60]) {
            await new Promise(ok => setTimeout(ok, espera * 1000 - (espera === 60 ? 5000 : 0)));
            const a = await pedaco(link, 0), b = await pedaco(link, meio + 5 * 1024 * 1024);
            linhas.push({ nome: `Link ${espera} s depois de apagar`, detalhe: `começo HTTP ${a} · meio HTTP ${b}`, ok: a === 206 && b === 206 });
        }
        const depois = await pedir(`${API}/torrents/mylist?bypass_cache=true`, { headers: auth });
        const listaDepois = Array.isArray(depois.json && depois.json.data) ? depois.json.data : [];
        linhas.push({ nome: 'Na conta depois', detalhe: `${listaDepois.length} torrents · ativos: ${listaDepois.filter(x => x.active).length}` });
    } catch (e) { linhas.push({ nome: 'Erro', detalhe: e.message }); }
    finally {
        if (torrentId && !apagado) await pedir(`${API}/torrents/controltorrent`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' }) }).catch(() => {});
    }
    const limpar = x => String(x).split(chave).join('***');
    const fim = linhas.filter(l => /depois de apagar/.test(l.nome));
    const resumo = [fim.length && fim.every(l => l.ok)
        ? 'O LINK CONTINUA TOCANDO depois de apagar da conta: o app pode liberar o slot logo depois de abrir o filme.'
        : 'O link PAROU (ou não deu para testar) depois de apagar: o app precisa manter o filme na conta enquanto alguém assiste.'];
    linhas.forEach(l => console.log(`${l.nome}: ${limpar(l.detalhe)}`));
    resumo.forEach(l => console.log(l));
    console.log('RESULTADO:' + JSON.stringify({ resumo, resultados: linhas.map(l => ({ nome: l.nome, status: l.ok ? 'forte' : '', qualidade: '', detalhe: limpar(l.detalhe) })) }));
}

// ------------------------------------------------------------ modo --procurar
// Procura TUDO de um título nas listas que a TorBox usa e mostra cada torrent
// com cara de português: rótulo, tamanho, se está pronto na TorBox e o motivo
// de o app ter (ou não) usado. Não gasta download. Padrão: Curvas da Vida.
async function procurar() {
    const chave = lerChave();
    if (!chave) { console.log('Sem chave.'); return; }
    const i = process.argv.indexOf('--procurar');
    const alvo = /^tt\d{5,10}(:\d+:\d+)?$/.test(process.argv[i + 1] || '') ? process.argv[i + 1] : 'tt2083383';
    const tipo = alvo.includes(':') ? 'series' : 'movie';
    const tb = require('../torbox-source');
    const respostas = await Promise.all(tb.listas().map(base => pedir(`${base}/stream/${tipo}/${alvo}.json`, {}, 20000).catch(() => ({ status: 0, json: null }))));
    const streams = tb.juntar(respostas.map(r => (r.json && Array.isArray(r.json.streams) ? r.json.streams : [])));
    const rotulo = s => `${s.name || ''} ${s.title || ''} ${s.description || ''} ${(s.behaviorHints || {}).filename || ''}`;
    // Mostra também os "suspeitos" (DUAL/MULTI sem dizer o idioma) e os latinos.
    const interessa = s => tb.ehPortugues(rotulo(s)) || /\b(dual|multi)\b|🇵🇹|🇧🇷|lat(ino)?\b|castellano/i.test(rotulo(s));
    const candidatos = streams.filter(interessa);
    const prontos = await emCache(chave, candidatos.map(s => tb.hashDe(s)));
    const resultados = candidatos.map(s => {
        const r = rotulo(s).replace(/\s+/g, ' ');
        const dublado = tb.dubladoExplicito(r) ? 'dublado PT declarado' : tb.ehPortugues(r) ? 'DUAL sem dizer o idioma' : 'outro idioma (latino/espanhol/multi)';
        const pronto = prontos.has(tb.hashDe(s));
        return { nome: `${tb.qualidade(r) || '?'} · ${tamanho(r) || '?'} · ${origem(r) || ''}`.trim(), status: pronto && tb.ehPortugues(r) ? 'forte' : tb.ehPortugues(r) ? 'dublado sem cache' : 'sem dublado', qualidade: tb.qualidade(r) || '', detalhe: `${pronto ? 'PRONTO na TorBox' : 'não está pronto'} · ${dublado} · ${r.slice(0, 160)}` };
    });
    const resumo = [
        `${alvo}: listas ${respostas.map(r => r.status + '/' + ((r.json && r.json.streams) || []).length).join(' ')} · ${streams.length} torrents no total · ${candidatos.length} com cara de português/dual · ${resultados.filter(r => /PRONTO/.test(r.detalhe)).length} prontos na TorBox.`,
        'Verde = dublado pronto (o app já usa). Amarelo = dublado, mas a TorBox ainda não tem o arquivo — dá para pedir para ela baixar.',
    ];
    resultados.forEach(r => console.log(`${r.nome}: ${r.detalhe}`));
    resumo.forEach(l => console.log(l));
    console.log('RESULTADO:' + JSON.stringify({ resumo, resultados }));
}

// ------------------------------------------------------------ modo --anime
// Anime legendado pela TorBox (SÓ ANIME): para 4 animes, procura o episódio 1
// com legenda em português dentro do arquivo. Não toca nem converte.
async function anime() {
    const tb = require('../torbox-source');
    if (!tb.ativa()) { console.log('Sem chave.'); return; }
    const alvos = [
        { nome: 'Frieren T1E1', id: '209867' }, { nome: 'Solo Leveling T1E1', id: '127532' },
        { nome: 'Jujutsu Kaisen T1E1', id: '95479' }, { nome: 'Demon Slayer T1E1', id: '85937' },
    ];
    const resultados = [];
    for (const a of alvos) {
        const t0 = Date.now();
        const r = await tb.resolverAnimeLegendado(a.id, 1, 1, { hevcOk: true }).catch(() => null);
        const s = ((Date.now() - t0) / 1000).toFixed(1);
        resultados.push({ nome: a.nome, status: r ? 'forte' : 'sem dublado', qualidade: r ? r.resolucao : '', detalhe: r ? `${s} s · ${r.fonte} · vídeo ${r.videoCodec || '?'} · faixa de áudio ${r.faixa && r.faixa.indice} · legenda ${r.legenda && r.legenda.indice}` : `${s} s · nenhum arquivo pronto com legenda em português` });
        console.log(`${a.nome}: ${resultados[resultados.length - 1].detalhe}`);
    }
    console.log('RESULTADO:' + JSON.stringify({ resumo: ['Anime legendado (só anime): verde = achou episódio com legenda em português dentro do arquivo, pronto na TorBox. Não gasta conversão.'], resultados }));
}

if (require.main === module) (process.argv.includes('--anime') ? anime() : process.argv.includes('--procurar') ? procurar() : process.argv.includes('--slots') ? slots() : process.argv.includes('--link') ? link() : process.argv.includes('--fonte') ? fonte() : process.argv.includes('--tocar') ? tocar() : principal()).catch(erro => { console.log('erro: ' + erro.message); process.exitCode = 1; });
module.exports = { lerChave, ehPortugues, qualidade, tamanho, origem, TITULOS, escolherArquivo, veredito };
