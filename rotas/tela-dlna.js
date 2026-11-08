// rotas/tela-dlna.js — TV SEM o app (DLNA: Samsung, LG, TCL, Philips, Sony…)
// (08/11/2026). O celular acha a TV no Wi-Fi e entrega um LINK; quem toca é a
// TV. O link é temporário (6 h), assinado, e aponta só para UMA conversão do
// servidor — nada de chave TorBox, nada de outras rotas. Vai em HTTP simples
// (/tv/…), porque as TVs não abrem HTTPS de endereço IP.
//
// O vídeo sai como MPEG-TS contínuo (o formato que toda TV DLNA aceita): os
// pedaços HLS da conversão, em ordem, a partir do ponto em que o celular
// estava. A legenda (anime legendado) sai como SRT no mesmo tempo.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function registrar(app, ctx) {
    const conversor = require('../conversor');
    const VALIDADE = 6 * 60 * 60 * 1000;
    let segredo = '';
    function chave() {
        if (segredo) return segredo;
        const arquivo = path.join(ctx.DADOS_DIR || '.', 'tela-segredo.txt');
        try { segredo = fs.readFileSync(arquivo, 'utf8').trim(); } catch { segredo = ''; }
        if (!/^[a-f0-9]{64}$/.test(segredo)) {
            segredo = crypto.randomBytes(32).toString('hex');
            try { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, segredo, { mode: 0o600 }); } catch { /* fica só na memória */ }
        }
        return segredo;
    }
    const assinar = corpo => crypto.createHmac('sha256', chave()).update(corpo).digest('base64url').slice(0, 32);
    function criarToken(dados) { const corpo = Buffer.from(JSON.stringify(dados)).toString('base64url'); return `${corpo}.${assinar(corpo)}`; }
    function lerToken(tok) {
        const [corpo, sig] = String(tok || '').split('.');
        if (!corpo || !sig || corpo.length > 400) return null;
        const certo = assinar(corpo);
        if (sig.length !== certo.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(certo))) return null;
        try { const d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')); return d && d.e > Date.now() && /^[A-Za-z0-9_-]{1,96}$/.test(d.c) ? d : null; } catch { return null; }
    }

    // Lista de pedaços do vídeo (anime legendado tem lista mestra: vídeo em index0.m3u8).
    function pedacos(conversao) {
        const mestra = conversor.caminhoDoPedaço(conversao, 'index.m3u8');
        if (!mestra) return null;
        let texto = '';
        try { texto = fs.readFileSync(mestra, 'utf8'); } catch { return null; }
        if (/#EXT-X-STREAM-INF/.test(texto)) { const v = conversor.caminhoDoPedaço(conversao, 'index0.m3u8'); try { texto = v ? fs.readFileSync(v, 'utf8') : ''; } catch { texto = ''; } }
        const itens = []; let dur = 0, tempo = 0;
        for (const linha of texto.split(/\r?\n/)) {
            const m = linha.match(/^#EXTINF:([0-9.]+)/);
            if (m) { dur = Number(m[1]) || 0; continue; }
            if (linha && !linha.startsWith('#')) { itens.push({ nome: linha.trim(), inicio: tempo, dur }); tempo += dur; }
        }
        return { itens, fim: /#EXT-X-ENDLIST/.test(texto) };
    }
    const hostPublico = req => {
        const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().replace(/:\d+$/, '');
        return /^[a-z0-9.-]{3,80}$/i.test(h) ? h : '';
    };

    // O celular pede o link (com login). posicao = segundos DENTRO da conversão.
    app.get('/api/tela/link', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const conversao = String(req.query.conversao || '');
        if (!/^[A-Za-z0-9_-]{1,96}$/.test(conversao)) return res.status(400).json({ ok: false });
        const lista = pedacos(conversao);
        if (!lista || !lista.itens.length) return res.status(404).json({ ok: false, motivo: 'Este vídeo ainda está sendo preparado. Tente de novo em alguns segundos.' });
        const pos = Math.max(0, Number(req.query.posicao) || 0);
        let s = 0;
        for (let i = 0; i < lista.itens.length; i++) if (lista.itens[i].inicio <= pos) s = i;
        const host = hostPublico(req);
        if (!host) return res.status(500).json({ ok: false });
        const temLegenda = Boolean(conversor.caminhoDoPedaço(conversao, 'legenda-externa.srt') || conversor.caminhoDoPedaço(conversao, 'index0_vtt.m3u8'));
        const tok = criarToken({ c: conversao, s, t: Math.round(lista.itens[s].inicio * 1000) / 1000, e: Date.now() + VALIDADE });
        const base = `http://${host}/tv/${tok}`;
        res.json({ ok: true, video: `${base}/video.ts`, legenda: temLegenda ? `${base}/legenda.srt` : '', inicio: lista.itens[s].inicio });
    });

    const CAB_DLNA = {
        'Content-Type': 'video/mp2t',
        'transferMode.dlna.org': 'Streaming',
        'contentFeatures.dlna.org': 'DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
    };

    // A TV puxa o vídeo (sem login: vale o link assinado).
    app.all('/tv/:tok/video.ts', async (req, res) => {
        const d = lerToken(req.params.tok);
        if (!d) return res.status(403).end();
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
        const legenda = `http://${hostPublico(req)}/tv/${req.params.tok}/legenda.srt`;
        res.writeHead(200, { ...CAB_DLNA, 'CaptionInfo.sec': legenda });
        if (req.method === 'HEAD') return res.end();
        let fechado = false;
        req.on('close', () => { fechado = true; });
        let i = d.s, esperando = 0;
        while (!fechado) {
            const lista = pedacos(d.c);
            if (!lista) break;
            if (i < lista.itens.length) {
                esperando = 0;
                const arq = conversor.caminhoDoPedaço(d.c, lista.itens[i].nome);
                i++;
                if (!arq) continue;
                await new Promise(ok => {
                    const leitor = fs.createReadStream(arq);
                    leitor.on('error', ok); leitor.on('end', ok);
                    res.on('close', () => { leitor.destroy(); ok(); });
                    leitor.pipe(res, { end: false });
                });
                continue;
            }
            if (lista.fim) break;
            // Conversão ainda andando: espera o próximo pedaço (até 90 s parada).
            if (++esperando > 90) break;
            await new Promise(ok => setTimeout(ok, 1000));
        }
        if (!fechado) res.end();
    });

    // Legenda em SRT, no tempo do vídeo que a TV recebe (começa em 0).
    const vttTempo = t => { const p = String(t).trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
    const srtTempo = s => { const ms = Math.max(0, Math.round(s * 1000)); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    function falasDoVtt(texto) {
        const falas = [];
        for (const bloco of String(texto).replace(/\r/g, '').split(/\n{2,}/)) {
            const linhas = bloco.split('\n'); const i = linhas.findIndex(l => l.includes('-->'));
            if (i < 0) continue;
            const [a, b] = linhas[i].split('-->'); const ini = vttTempo(a), fim = vttTempo(String(b).trim().split(/\s+/)[0]);
            const txt = linhas.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
            if (Number.isFinite(ini) && Number.isFinite(fim) && txt && txt !== '​') falas.push({ ini, fim, txt });
        }
        return falas;
    }
    function falasDoSrt(texto) {
        const falas = [];
        for (const bloco of String(texto).replace(/\r/g, '').split(/\n{2,}/)) {
            const linhas = bloco.split('\n'); const i = linhas.findIndex(l => l.includes('-->'));
            if (i < 0) continue;
            const [a, b] = linhas[i].split('-->'); const t = x => vttTempo(String(x).trim().replace(',', '.'));
            const txt = linhas.slice(i + 1).join('\n').trim();
            if (txt && txt !== '​') falas.push({ ini: t(a), fim: t(b), txt });
        }
        return falas;
    }
    app.all('/tv/:tok/legenda.srt', (req, res) => {
        const d = lerToken(req.params.tok);
        if (!d) return res.status(403).end();
        let falas = [];
        const externa = conversor.caminhoDoPedaço(d.c, 'legenda-externa.srt');
        if (externa) { try { falas = falasDoSrt(fs.readFileSync(externa, 'utf8')); } catch { falas = []; } }
        else {
            const lista = conversor.caminhoDoPedaço(d.c, 'index0_vtt.m3u8');
            let nomes = [];
            try { nomes = fs.readFileSync(lista, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')); } catch { nomes = []; }
            const vistas = new Set();
            for (const nome of nomes) {
                const arq = conversor.caminhoDoPedaço(d.c, nome.trim());
                if (!arq) continue;
                try { for (const f of falasDoVtt(fs.readFileSync(arq, 'utf8'))) { const k = f.ini + '|' + f.txt; if (!vistas.has(k)) { vistas.add(k); falas.push(f); } } } catch { /* pedaço sumiu */ }
            }
        }
        const saida = falas.filter(f => f.fim > d.t).sort((a, b) => a.ini - b.ini)
            .map((f, n) => `${n + 1}\n${srtTempo(f.ini - d.t)} --> ${srtTempo(f.fim - d.t)}\n${f.txt}`).join('\n\n');
        res.writeHead(200, { 'Content-Type': 'text/srt; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(req.method === 'HEAD' ? undefined : (saida ? saida + '\n' : ''));
    });
    return {};
};
module.exports._teste = true;
