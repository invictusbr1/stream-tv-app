// rotas/tela.js — "Enviar para a TV" (08/11/2026). O celular (ou o PC) manda
// o título que está assistindo para uma TV da família que esteja com o Conecta
// TV aberto — Mi Box/Android TV pelo app, Samsung e LG pelo navegador da TV.
// A TV acha a melhor fonte para ELA (4K, codec, áudio) e começa no mesmo ponto.
// Nada de vídeo passa por aqui: só o pedido "toque isto a partir de X".
module.exports = function registrar(app) {
    const telas = new Map();      // id do aparelho → { nome, tipo, visto, pedido }
    const ONLINE = 45 * 1000;
    const idOk = v => /^[a-z0-9]{6,32}$/.test(String(v || ''));
    const limpar = () => { const agora = Date.now(); for (const [id, t] of telas) if (agora - t.visto > 10 * 60 * 1000) telas.delete(id); };
    const nomeDe = (req, padrao) => String((req.dispositivoAutorizado && req.dispositivoAutorizado.nome) || '').trim() || String(req.query.nome || '').replace(/[^\p{L}\p{N} ·()'-]/gu, '').trim().slice(0, 40) || padrao;

    // A TV avisa que está ligada e, na mesma pergunta, recebe o pedido pendente.
    app.get('/api/tela/receber', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const eu = String(req.query.eu || '');
        if (!idOk(eu)) return res.status(400).json({ ok: false });
        limpar();
        const atual = telas.get(eu) || {};
        const tela = { ...atual, nome: nomeDe(req, atual.nome || 'TV'), tipo: String(req.query.tipo || atual.tipo || 'tv').slice(0, 20), visto: Date.now() };
        const pedido = tela.pedido && Date.now() - tela.pedido.em < 2 * 60 * 1000 ? tela.pedido : null;
        tela.pedido = null;
        telas.set(eu, tela);
        res.json({ ok: true, pedido });
    });

    // Quem está ligado agora (para o celular escolher).
    app.get('/api/tela/receptores', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const eu = String(req.query.eu || '');
        const agora = Date.now();
        res.json([...telas.entries()].filter(([id, t]) => id !== eu && agora - t.visto < ONLINE).map(([id, t]) => ({ id, nome: t.nome, tipo: t.tipo })));
    });

    // Manda o título. GET (o app do celular só encaminha GET ao servidor).
    app.get('/api/tela/enviar', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const para = String(req.query.para || ''), tela = telas.get(para);
        if (!idOk(para) || !tela || Date.now() - tela.visto > ONLINE) return res.status(404).json({ ok: false, motivo: 'Essa TV não está com o Conecta TV aberto agora.' });
        const id = String(req.query.id || ''), temporada = Number(req.query.temporada || 0), episodio = Number(req.query.episodio || 0);
        if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ ok: false });
        const titulo = String(req.query.titulo || '').slice(0, 120);
        const posicao = Math.max(0, Math.min(6 * 3600, Math.floor(Number(req.query.posicao) || 0)));
        const audio = ['legendado', 'dublado'].includes(req.query.audio) ? req.query.audio : '';
        const episode = temporada >= 0 && episodio >= 1 && req.query.tipo === 'tv'
            ? { season: temporada, number: episodio, ...(req.query.anime === '1' ? { anime: true, audio: audio || 'legendado' } : {}) } : null;
        tela.pedido = { em: Date.now(), id, titulo, episode, posicao, capa: /^https:\/\/image\.tmdb\.org\//.test(String(req.query.capa || '')) ? String(req.query.capa) : '', de: nomeDe(req, 'Celular') };
        res.json({ ok: true, nome: tela.nome });
    });
    return {};
};
