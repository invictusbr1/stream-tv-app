// rotas/aparelhos.js — Aparelhos: lista, bloqueio e liberação de quem entrou no aplicativo.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { portao } = ctx;
// ============================================================
// APARELHOS — quem entrou no aplicativo, com controle para o dono.
// ============================================================
app.get('/api/dispositivos', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ dispositivos: portao.listarDispositivos() });
});

app.post('/api/dispositivos/bloquear', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const alvo = String(req.body?.token || req.body?.dispositivo || '');
    if (!alvo) return res.status(400).json({ error: 'informe o aparelho' });
    const removido = portao.bloquearDispositivo(alvo);
    if (!removido) return res.status(404).json({ error: 'aparelho não encontrado' });
    res.json({ ok: true, removido });
});

app.post('/api/dispositivos/liberar', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const liberado = portao.liberarDispositivo(String(req.body?.dispositivo || ''));
    res.json({ ok: liberado });
});

return {  };
};
