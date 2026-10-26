// rotas/legendas.js — Legendas locais (.srt/.vtt) e busca de legendas online.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { ARQ_LEGENDAS, fs, path } = ctx;
// getImdbId mora em rotas/legado-players.js (registrado depois): busca na hora do uso.
const getImdbId = (...args) => ctx.getImdbId(...args);
// ============================================================
// LEGENDAS — arquivos .srt/.vtt na pasta "Legendas" do aplicativo
// ============================================================
function normalizarTexto(valor) {
    return String(valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function lerLegendas() {
    try { return fs.readdirSync(ARQ_LEGENDAS).filter(nome => /\.(srt|vtt)$/i.test(nome)); } catch { return []; }
}

app.get('/api/legendas', (req, res) => {
    const filme = normalizarTexto(req.query.filme);
    const id = String(req.query.id || '');
    const arquivos = lerLegendas().map(nome => ({ nome, chave: normalizarTexto(nome.replace(/\.(srt|vtt)$/i, '')) }));
    const palavras = filme.split(' ').filter(p => p.length > 2);
    const pontuar = item => palavras.filter(p => item.chave.includes(p)).length + (id && item.chave.includes(id) ? 5 : 0);
    const encontradas = arquivos.map(item => ({ ...item, pontos: pontuar(item) })).filter(item => item.pontos > 0).sort((a, b) => b.pontos - a.pontos).slice(0, 4);
    res.json({ pasta: ARQ_LEGENDAS, total: arquivos.length, encontradas: encontradas.map(item => item.nome) });
});

app.get('/api/legenda', (req, res) => {
    const nome = path.basename(String(req.query.arquivo || ''));
    if (!/\.(srt|vtt)$/i.test(nome)) return res.status(400).send('Arquivo inválido');
    const caminho = path.join(ARQ_LEGENDAS, nome);
    if (!caminho.startsWith(ARQ_LEGENDAS)) return res.status(400).send('Caminho inválido');
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain; charset=utf-8').sendFile(caminho, erro => { if (erro && !res.headersSent) res.status(404).send('Legenda não encontrada'); });
});

// Busca de legenda na internet, sem cadastro: YIFY Subtitles em português.
// Usada quando o filme toca com o áudio original — a legenda entra sozinha.
app.get('/api/legendas/online', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const legendasOnline = require('../legendas-online');
        let imdb = String(req.query.imdb || '').trim();
        if (!/^tt\d{5,10}$/i.test(imdb) && /^\d{1,10}$/.test(String(req.query.id || ''))) {
            // O tipo decide a rota do TMDB. A interface do aparelho ainda pede só o id:
            // quando a ficha de filme não traz o código, o título é série — tenta a de série.
            const tipoDoPedido = String(req.query.tipo || '').toLowerCase();
            imdb = String(await getImdbId(String(req.query.id), tipoDoPedido).catch(() => '') || '');
            // A ficha de filme pode devolver um código de OUTRO título (o TMDB tem filmes com o mesmo número): só vale o que tem formato de IMDb.
            if (!tipoDoPedido && !/^tt\d{5,10}$/i.test(imdb)) imdb = String(await getImdbId(String(req.query.id), 'tv').catch(() => '') || '');
        }
        // Base sem o título (série, por exemplo) não é erro: devolve lista vazia.
        const encontradas = imdb ? await legendasOnline.listar(imdb).catch(() => []) : [];
        res.json({ fonte: 'YIFY', imdb, encontradas });
    } catch (erro) {
        res.status(502).json({ error: 'Não foi possível buscar as legendas agora.', encontradas: [] });
    }
});

// Baixa a legenda escolhida e guarda uma cópia na pasta do aplicativo — na
// próxima vez ela já entra como legenda local, mesmo sem internet.
app.get('/api/legenda-online', async (req, res) => {
    try {
        const legendasOnline = require('../legendas-online');
        const achada = await legendasOnline.baixar(String(req.query.arquivo || ''));
        if (!achada || !String(achada.texto || '').trim()) return res.status(404).send('Legenda não encontrada.');
        try {
            fs.mkdirSync(ARQ_LEGENDAS, { recursive: true });
            const titulo = String(req.query.filme || achada.nome || 'legenda')
                .replace(/\.(srt|vtt)$/i, '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'legenda';
            const destino = path.join(ARQ_LEGENDAS, `${titulo}.srt`);
            if (!fs.existsSync(destino)) fs.writeFileSync(destino, achada.texto, 'utf8');
        } catch { /* sem permissão para guardar: a legenda vale só agora */ }
        res.setHeader('Cache-Control', 'no-store');
        res.type('text/plain; charset=utf-8').send(achada.texto);
    } catch {
        res.status(502).send('Não foi possível baixar a legenda agora.');
    }
});

return { normalizarTexto, lerLegendas };
};
