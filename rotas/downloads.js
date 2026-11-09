// rotas/downloads.js — Baixar episódio/filme, conversão de áudio e avaliação de fontes.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { LOCAL_CONFIG, fs, midia, seguranca } = ctx;
// ============================================================
// DOWNLOAD DE VERDADE DO EPISÓDIO — o botão ⤓ do painel da série grava o
// arquivo no computador (Downloads\Conecta TV), usando exatamente a mesma
// fonte dublada e sem anúncio que o player escolhe. O andamento é consultado
// por /api/baixar/estado; no celular o download não existe (não há servidor).
// ============================================================
async function fonteParaBaixar({ tipo, id, temporada, episodio }) {
    if (tipo === 'tv') {
        const cookie = process.env.WATCHPLAY_COOKIE || LOCAL_CONFIG.watchplayCookie || '';
        const alvo = { tipo: 'tv', tmdbId: id, temporada, episodio };
        let escolhido = null;
        if (process.env.AVALIADOR !== '0') {
            const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { exceto: [] }).catch(() => null);
            if (resultado) escolhido = require('../fontes-motor').prepararParaPlayer(resultado.escolhido);
        }
        if (!escolhido) escolhido = await require('../series-source').resolverEpisodio({ tmdbId: id, temporada, episodio, cookie, exceto: [] }).catch(() => null);
        if (!escolhido) return null;
        return {
            url: escolhido.urlAplicativo || escolhido.url,
            referer: escolhido.referer || '',
            fonte: escolhido.fonte || '',
        };
    }
    const motor = require('../fontes-motor');
    const alvo = { tipo: 'movie', tmdbId: id };
    let escolhido = null;
    if (process.env.AVALIADOR !== '0') {
        const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { exceto: [] }).catch(() => null);
        if (resultado) escolhido = resultado.escolhido;
    }
    if (!escolhido) escolhido = await motor.escolher('dublado', alvo, { exceto: [] });
    if (!escolhido) return null;
    const pronto = motor.prepararParaPlayer(escolhido);
    return {
        url: pronto.urlAplicativo || pronto.url,
        referer: escolhido.referer || '',
        fonte: escolhido.fonte || '',
    };
}

app.get('/api/baixar', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const baixador = require('../baixador');
    const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
    const id = String(req.query.id || '');
    if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ erro: 'identificador inválido' });
    const temporada = /^\d{1,3}$/.test(String(req.query.temporada || '')) ? String(req.query.temporada) : '1';
    const episodio = /^[1-9]\d{0,3}$/.test(String(req.query.episodio || '')) ? String(req.query.episodio) : '1';
    const titulo = String(req.query.titulo || '').slice(0, 80);
    try {
        const fonte = await fonteParaBaixar({ tipo, id, temporada, episodio });
        if (!fonte || !fonte.url) return res.status(502).json({ erro: 'Nenhuma fonte dublada sem anúncio está disponível para baixar agora.' });
        const rotulo = tipo === 'tv'
            ? `${titulo || 'Episódio'} T${temporada}E${episodio}`
            : (titulo || `Filme ${id}`);
        const trabalho = await baixador.iniciar(fonte.url, {
            rotulo,
            referer: fonte.referer,
            id: `${tipo}-${id}-${temporada}-${episodio}`,
        });
        return res.json({ ok: true, fonte: fonte.fonte, ...trabalho });
    } catch (erro) {
        return res.status(502).json({ erro: 'Não foi possível preparar o download agora.' });
    }
});

app.get('/api/baixar/estado', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(require('../baixador').estado(String(req.query.id || '')));
});

app.get('/api/baixar/cancelar', (req, res) => {
    res.json({ ok: require('../baixador').cancelar(String(req.query.id || '')) });
});

// ------------------------------------------------------------
// CONVERSÃO DE ARQUIVO — para provedores que entregam MKV com som que o
// navegador não toca. O vídeo é copiado (sem perda) e o áudio vira AAC.
// ------------------------------------------------------------
app.get('/api/converter', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let endereco = '';
    try { endereco = midia.textoDeBase64url(req.query.url || ''); } catch { return res.status(400).json({ erro: 'endereço inválido' }); }
    if (!endereco || /[\u0000-\u0020\u007f]/.test(endereco)) return res.status(400).json({ erro: 'endereço inválido' });
    let urlParsed;
    try { urlParsed = new URL(endereco); } catch { return res.status(400).json({ erro: 'endereço inválido' }); }
    if (urlParsed.username || urlParsed.password) return res.status(400).json({ erro: 'endereço inválido' });
    // Aceita https de host permitido e o endereço local do próprio servidor (127.0.0.1 na mesma porta).
    const portaLocal = String(req.socket?.localPort || process.env.PORT || 3000);
    const ehLocal = urlParsed.protocol === 'http:' && urlParsed.hostname === '127.0.0.1' && (!urlParsed.port || urlParsed.port === portaLocal);
    const hostOk = ehLocal || (urlParsed.protocol === 'https:' && !seguranca.hostInterno(urlParsed.hostname) && midia.hostPermitido(urlParsed.hostname));
    if (!hostOk) return res.status(400).json({ erro: 'endereço inválido' });
    const refererBruto = String(req.query.referer || '').replace(/[\r\n\u0000-\u001f\u007f]/g, '').slice(0, 200);
    let refererLimpo = '';
    if (refererBruto) {
        try {
            const refUrl = new URL(refererBruto);
            if (refUrl.protocol === 'https:' && !refUrl.username && !refUrl.password && !seguranca.hostInterno(refUrl.hostname)) refererLimpo = refUrl.href;
        } catch { refererLimpo = ''; }
    }
    try {
        const conversor = require('../conversor');
        const trabalho = await conversor.iniciar(urlParsed.href, {
            titulo: String(req.query.titulo || 'video').slice(0, 60),
            referer: refererLimpo,
        });
        res.json({ ok: true, ...trabalho });
    } catch (erro) {
        res.status(502).json({ erro: String(erro.message).slice(0, 120) });
    }
});

app.get('/api/conversao/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const conversor = require('../conversor');
    res.json(conversor.estado(String(req.params.id || '')));
});

// Conferência do avaliador em tempo real: mostra o que cada fonte entrega
// para um título (nota, altura, idioma, tempo) sem abrir o player.
app.get('/api/avaliar/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^\d{1,10}$/.test(req.params.id)) return res.sendStatus(400);
    const tipoEpisodio = String(req.query.temporada || '') !== '' && String(req.query.episodio || '') !== '';
    const alvo = tipoEpisodio
        ? { tipo: 'tv', tmdbId: req.params.id, temporada: String(req.query.temporada), episodio: String(req.query.episodio) }
        : { tipo: 'movie', tmdbId: req.params.id };
    try {
        const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { semCache: true, exceto: String(req.query.exceto || '').split(',').filter(Boolean) });
        if (!resultado) return res.json({ ok: false, motivo: 'nenhuma fonte respondeu' });
        res.json({ ok: true, tempoMs: resultado.tempoMs, melhor: resultado.escolhido.fonteId, avaliacao: resultado.avaliacao });
    } catch (erro) {
        res.status(502).json({ erro: String(erro.message).slice(0, 120) });
    }
});

// Entrega o arquivo em conversão (com suporte a avançar/voltar, quando o
// trecho pedido já foi convertido).
app.get('/api/convertido/:id', (req, res) => {
    const conversor = require('../conversor');
    const arquivo = conversor.arquivoDe(String(req.params.id || ''));
    if (!arquivo) return res.status(404).send('ainda não há conversão');
    // A conversão é uma lista HLS: o player pede o arquivo e os pedaços.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (/\.m3u8$/i.test(arquivo)) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return fs.createReadStream(arquivo).pipe(res);
    }
    let total = 0;
    try { total = fs.statSync(arquivo).size; } catch { return res.status(404).send('arquivo indisponível'); }
    if (!total) return res.status(404).send('ainda sem dados');
    res.setHeader('Accept-Ranges', 'bytes');
    res.type(/\.ts$/i.test(arquivo) ? 'video/mp2t' : /\.m4s$/i.test(arquivo) ? 'video/iso.segment' : 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    const faixa = String(req.headers.range || '');
    const achado = faixa.match(/bytes=(\d*)-(\d*)/);
    if (achado) {
        const inicio = achado[1] ? Number(achado[1]) : 0;
        const fim = Math.min(achado[2] ? Number(achado[2]) : total - 1, total - 1);
        if (inicio >= total || fim < inicio) {
            res.status(416).setHeader('Content-Range', `bytes */${total}`);
            return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${total}`);
        res.setHeader('Content-Length', fim - inicio + 1);
        return fs.createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
    }
    res.setHeader('Content-Length', total);
    return fs.createReadStream(arquivo).pipe(res);
});

// Pedaços da conversão (segmentos .ts): mesma pasta, nome conferido.
app.get('/api/convertido/:id/:pedaco', (req, res) => {
    const conversor = require('../conversor');
    const nome = String(req.params.pedaco || '');
    const arquivo = conversor.caminhoDoPedaço(String(req.params.id || ''), nome);
    if (!arquivo) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', /\.m3u8$/i.test(nome) ? 'application/vnd.apple.mpegurl' : /\.ts$/i.test(nome) ? 'video/mp2t' : /\.vtt$/i.test(nome) ? 'text/vtt; charset=utf-8' : 'application/octet-stream');
    return fs.createReadStream(arquivo).pipe(res);
});

return { fonteParaBaixar };
};
