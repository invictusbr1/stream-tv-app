'use strict';
// Rotas do aplicativo do PC (Conecta TV para Windows). Só existem quando o
// programa é aberto pelo atalho do PC (CONECTA_PC=1): o servidor da Oracle e
// o site nunca abrem um player no computador de ninguém.
//
// Proteções: só aceita pedidos deste próprio computador (127.0.0.1), com o
// Host exato e com a chave sorteada a cada abertura do aplicativo.

function registrarPc(app, ctx = {}) {
    if (process.env.CONECTA_PC !== '1') return {};
    const { criarPlayer } = require('../pc/mpv.cjs');
    const { criarInstalador } = require('../pc/instalador.cjs');
    const { acharMpv } = require('../pc/mpv.cjs');
    const player = ctx.playerPc || criarPlayer();
    const instalador = ctx.instaladorPc || criarInstalador({ acharExe: acharMpv });
    const chave = () => String(process.env.CONECTA_PC_TOKEN || '');
    let ultimoUso = Date.now();

    const local = endereco => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(String(endereco || ''));
    const seguranca = require('../seguranca');
    function guarda(req, res, next) {
        const host = String(req.headers.host || '');
        const porta = String(req.socket.localPort || '');
        const hostOk = host === `127.0.0.1:${porta}` || host === `localhost:${porta}`;
        if (!local(req.socket.remoteAddress) || !hostOk || !chave() || !seguranca.compararSegredo(req.headers['x-conecta-pc'], chave())) return res.status(403).json({ erro: 'pedido não permitido' });
        ultimoUso = Date.now();
        res.setHeader('Cache-Control', 'no-store');
        next();
    }

    app.get('/api/pc/estado', guarda, (req, res) => res.json({ pc: true, player: player.estado(), instalacao: instalador.estado() }));

    // Espera uma mudança no player (imagem, pausa, fim) por até 20 s.
    app.get('/api/pc/esperar', guarda, async (req, res) => {
        const sessao = String(req.query.sessao || '');
        const agora = player.estado();
        if (sessao && agora.sessao !== sessao) return res.json(agora);
        const ms = Math.min(25000, Math.max(1000, Number(req.query.ms) || 20000));
        res.json(await player.esperar(ms));
    });

    app.post('/api/pc/instalar', guarda, (req, res) => res.json(instalador.iniciar()));

    app.post('/api/pc/tocar', guarda, (req, res) => {
        const corpo = req.body || {};
        // Endereço relativo (vídeo entregue por este próprio programa) vira
        // endereço completo deste computador.
        let url = String(corpo.url || '');
        if (url.startsWith('/')) url = `http://127.0.0.1:${req.socket.localPort}${url}`;
        if (!instalador.estado().pronto) { instalador.iniciar(); return res.status(409).json({ erro: 'o player do PC está sendo instalado', instalacao: instalador.estado() }); }
        const r = player.tocar({ url, titulo: corpo.titulo, posicao: corpo.posicao, referer: corpo.referer });
        res.status(r.erro ? 400 : 200).json(r);
    });

    app.post('/api/pc/parar', guarda, (req, res) => { player.parar(); res.json({ ok: true }); });

    const api = { ociosoHa: () => (player.ocupado() || instalador.estado().instalando) ? 0 : Date.now() - ultimoUso, playerPc: player };
    registrarPc.ultimo = api;
    return api;
}
module.exports = registrarPc;
