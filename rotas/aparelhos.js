// rotas/aparelhos.js — Aparelhos: lista, bloqueio e liberação de quem entrou no aplicativo.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { portao, seguranca, LOCAL_CONFIG = {} } = ctx;
const CHAVE_CENTRAL = String(process.env.CENTRAL_KEY || LOCAL_CONFIG.centralKey || '').trim();
const TOKEN_CENTRAL = String(process.env.CENTRAL_TOKEN || LOCAL_CONFIG.centralToken || '').trim();

// Apenas a Central (autenticada como "central-conecta-tv" ou com chave/token da
// central) ou pedidos locais do próprio servidor podem listar tokens e bloquear
// outros aparelhos — evita que um usuário comum expulse os demais.
function ehDonoOuCentral(req) {
    const disp = req.dispositivoAutorizado;
    if (disp && disp.dispositivo === 'central-conecta-tv') return true;
    const ip = seguranca ? seguranca.ipDoPedido(req) : '';
    if (ip === '127.0.0.1' || ip === '::1') return true;
    const comparar = (seguranca && seguranca.compararSegredo) || ((a, b) => Boolean(a && b && String(a) === String(b)));
    const chaveReq = String(req.headers['x-chave'] || req.query?.chave || '');
    if (CHAVE_CENTRAL.length >= 8 && comparar(chaveReq, CHAVE_CENTRAL)) return true;
    const tokenReq = String(req.headers['x-central'] || '');
    if (TOKEN_CENTRAL.length >= 8 && comparar(tokenReq, TOKEN_CENTRAL)) return true;
    return false;
}

// ============================================================
// APARELHOS — quem entrou no aplicativo, com controle para o dono.
// ============================================================
app.get('/api/dispositivos', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!ehDonoOuCentral(req)) return res.status(403).json({ error: 'Apenas a central do dono pode consultar os aparelhos.' });
    res.json({ dispositivos: portao.listarDispositivos() });
});

app.post('/api/dispositivos/bloquear', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!ehDonoOuCentral(req)) return res.status(403).json({ error: 'Apenas a central do dono pode bloquear aparelhos.' });
    const alvo = String(req.body?.token || req.body?.dispositivo || '');
    if (!alvo) return res.status(400).json({ error: 'informe o aparelho' });
    const removido = portao.bloquearDispositivo(alvo);
    if (!removido) return res.status(404).json({ error: 'aparelho não encontrado' });
    res.json({ ok: true, removido });
});

app.post('/api/dispositivos/liberar', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!ehDonoOuCentral(req)) return res.status(403).json({ error: 'Apenas a central do dono pode liberar aparelhos.' });
    const liberado = portao.liberarDispositivo(String(req.body?.dispositivo || ''));
    res.json({ ok: liberado });
});

return { ehDonoOuCentral };
};
