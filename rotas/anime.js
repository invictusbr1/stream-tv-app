// rotas/anime.js — Página de Animes (dados do AniList + TMDB + TorBox).
// Vem antes de rotas/catalogo (que responde a várias rotas /api/... por
// expressão regular).
module.exports = function registrar(app) {
    const catalogo = () => require('../anime-catalogo');
    app.get('/api/anime/pagina', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const p = await catalogo().obterPagina();
            if (!p) return res.status(503).json({ ok: false, motivo: 'AniList indisponível agora' });
            res.json(p);
        } catch { res.status(503).json({ ok: false }); }
    });
    app.get('/api/anime/recomendacoes', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const id = String(req.query.id || '');
        if (!/^\d{1,10}$/.test(id)) return res.status(400).json([]);
        try { res.json(await catalogo().recomendar(req.query.tipo === 'movie' ? 'movie' : 'tv', id)); } catch { res.json([]); }
    });
    return {};
};
