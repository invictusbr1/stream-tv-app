// rotas/acessos.js — Central de status e registro de acessos (/api/evento, /api/acesso, /central).
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { ARQ_ACESSOS, LOCAL_CONFIG, fs, seguranca, portao } = ctx;
const escaparHtml = seguranca.escaparHtml || (v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const compararSegredo = seguranca.compararSegredo || ((a, b) => Boolean(a && b && String(a) === String(b)));

// ============================================================
// CENTRAL DE STATUS — o aplicativo conta o que foi aberto. A central
// é opcional e nunca atrasa o player: se ela não responder, seguimos.
// ============================================================
const central = require('../central-reporter');
const CODIGO_APP = String(process.env.CONECTA_ACESSO_CODIGO || LOCAL_CONFIG.acessoCodigo || '').trim();
app.post('/api/evento', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // O player avisou que a fonte abriu mas não tocou: o motor aprende com
    // isso (a fonte sai da frente neste título e perde prioridade no geral).
    // Só aceita alterar a reputação das fontes se o pedido vier de um aparelho
    // autorizado ou com o código válido (evita envenenamento anônimo).
    try {
        const corpo = req.body || {};
        const codigoInformado = String(corpo.codigo || req.query?.codigo || req.headers['x-conecta-codigo'] || '').trim();
        const autorizado = !CODIGO_APP || Boolean(req.dispositivoAutorizado) || compararSegredo(codigoInformado, CODIGO_APP);
        if (autorizado && corpo.tipo === 'falha' && corpo.fonteId) {
            const motor = require('../fontes-motor');
            const ehEpisodio = Boolean(corpo.temporada && corpo.numero);
            const alvo = motor.alvoDoEvento(ehEpisodio ? 'tv' : 'movie', corpo.id, corpo.temporada, corpo.numero);
            motor.registrarFalha(String(corpo.fonteId).slice(0, 60), String(corpo.motivo || '').slice(0, 120), alvo ? `dublado:${motor.chaveDoTitulo(alvo)}` : '');
        }
    } catch { /* o aviso para a central segue normalmente */ }
    if (!central.configurada()) return res.json({ ok: true, central: false });
    const enviado = await central.reportar({ ...(req.body || {}), ip: ipDoPedido(req) }).catch(() => false);
    res.json({ ok: true, central: enviado });
});

// ============================================================
// REGISTRO DE ACESSOS — quem entrou, de qual aparelho e de qual IP
// Os dados ficam num arquivo ao lado do aplicativo e aparecem na central.
// ============================================================
// Sem chave configurada, esta tela não abre (nada de senha padrão).
const CHAVE_CENTRAL = String(process.env.CENTRAL_KEY || LOCAL_CONFIG.centralKey || '').trim();
const tentativasCentral = new Map();

function lerAcessos() {
    try { return JSON.parse(fs.readFileSync(ARQ_ACESSOS, 'utf8')) || {}; } catch { return {}; }
}

function gravarAcessos(lista) {
    try { fs.writeFileSync(ARQ_ACESSOS, JSON.stringify(lista, null, 1), 'utf8'); } catch { /* sem permissão de escrita */ }
}

const ipDoPedido = seguranca.ipDoPedido; // regra única (ver seguranca.js)

app.post('/api/acesso', (req, res) => {
    const corpo = req.body || {};
    const nome = String(corpo.nome || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    if (!nome) return res.status(400).json({ error: 'Informe o nome para usar o aplicativo.' });
    const dispositivo = String(corpo.dispositivo || '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 40) || ('ip-' + ipDoPedido(req));
    const lista = lerAcessos();
    // Limita o número total de entradas para evitar enchimento de disco por IPs aleatórios.
    const chaves = Object.keys(lista);
    if (!lista[dispositivo] && chaves.length >= 500) {
        const maisAntigo = chaves.sort((a, b) => String(lista[a]?.ultimoEm || '').localeCompare(String(lista[b]?.ultimoEm || '')))[0];
        if (maisAntigo) delete lista[maisAntigo];
    }
    const anterior = lista[dispositivo] || {};
    const agora = new Date().toISOString();
    lista[dispositivo] = {
        dispositivo,
        nome,
        aparelho: String(corpo.aparelho || 'Aparelho').replace(/[\u0000-\u001f]/g, ' ').slice(0, 40),
        app: String(corpo.app || anterior.app || 'conecta-tv').replace(/[\u0000-\u001f]/g, ' ').slice(0, 20),
        versao: String(corpo.versao || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 20),
        assistindo: corpo.assistindo ? String(corpo.assistindo).replace(/[\u0000-\u001f]/g, ' ').slice(0, 90) : (anterior.assistindo || null),
        ip: ipDoPedido(req),
        primeiroEm: anterior.primeiroEm || agora,
        ultimoEm: agora,
        vezes: Number(anterior.vezes || 0) + 1
    };
    gravarAcessos(lista);
    // Repassa para a central de status (quando configurada).
    require('../central-reporter').reportarAcesso(lista[dispositivo]).catch(() => {});
    const pessoas = new Set(Object.values(lista).map(item => String(item.nome || '').toLowerCase())).size;
    console.log(`[acesso] ${nome} · ${lista[dispositivo].aparelho} · ${lista[dispositivo].ip}`);
    res.json({ ok: true, pessoas, aparelhos: Object.keys(lista).length });
});

app.get('/central', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = ipDoPedido(req);
    const agoraMs = Date.now();
    const marca = tentativasCentral.get(ip) || { desde: agoraMs, erros: 0 };
    if (agoraMs - marca.desde > 600000) { marca.desde = agoraMs; marca.erros = 0; }
    if (marca.erros >= 8) {
        return res.status(429).type('html').send('<!doctype html><meta charset="utf-8"><body style="background:#0b0e15;color:#e8ecf3;font:16px system-ui;padding:40px">Muitas tentativas. Aguarde alguns minutos.</body>');
    }
    const chaveInformada = String(req.query.chave || req.headers['x-chave'] || '');
    if (CHAVE_CENTRAL.length < 8 || !compararSegredo(chaveInformada, CHAVE_CENTRAL)) {
        if (chaveInformada) { marca.erros++; tentativasCentral.set(ip, marca); }
        res.status(401).type('html').send('<!doctype html><meta charset="utf-8"><body style="background:#0b0e15;color:#e8ecf3;font:16px system-ui;padding:40px">Acesso restrito. Use <code>/central?chave=SUA-CHAVE</code>.</body>');
        return;
    }
    marca.erros = 0;
    tentativasCentral.set(ip, marca);
    const lista = Object.values(lerAcessos()).sort((a, b) => String(b.ultimoEm).localeCompare(String(a.ultimoEm)));
    const agora = Date.now();
    const ativos = lista.filter(item => agora - new Date(item.ultimoEm).getTime() < 5 * 60 * 1000);
    const pessoas = new Set(lista.map(item => String(item.nome || '').toLowerCase())).size;
    const linhas = lista.map(item => {
        const minutos = Math.round((agora - new Date(item.ultimoEm).getTime()) / 60000);
        const visto = minutos < 1 ? 'agora' : minutos < 60 ? `há ${minutos} min` : minutos < 1440 ? `há ${Math.round(minutos / 60)} h` : `há ${Math.round(minutos / 1440)} dia(s)`;
        const primeiro = escaparHtml(String(item.primeiroEm || '').slice(0, 16).replace('T', ' '));
        return `<tr><td>${escaparHtml(item.nome)}</td><td>${escaparHtml(item.aparelho)}</td><td>${escaparHtml(item.ip || '-')}</td><td>${escaparHtml(item.assistindo || '-')}</td><td>${escaparHtml(visto)}</td><td>${Number(item.vezes) || 1}</td><td>${primeiro}</td></tr>`;
    }).join('');
    res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Central do Conecta TV</title>
<style>body{margin:0;background:#0b0e15;color:#e8ecf3;font:15px system-ui;padding:28px}
h1{margin:0 0 6px}p.sub{color:#8d97a8;margin:0 0 22px}
.cards{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px}
.card{background:#151a24;border:1px solid #ffffff14;border-radius:14px;padding:16px 20px;min-width:150px}
.card b{display:block;font-size:26px;margin-bottom:4px}.card span{color:#8d97a8;font-size:12.5px}
table{width:100%;border-collapse:collapse;background:#12161f;border-radius:14px;overflow:hidden}
th,td{padding:11px 12px;text-align:left;border-bottom:1px solid #ffffff0f;font-size:13.5px}
th{background:#171c26;color:#aeb6c5;font-weight:600}tr:last-child td{border-bottom:0}
.ponto{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2fd07a;margin-right:6px}
</style></head><body>
<h1>Central do Conecta TV</h1><p class="sub">Atualize a página para ver os números mais recentes.</p>
<div class="cards"><div class="card"><b>${pessoas}</b><span>pessoas cadastradas</span></div><div class="card"><b>${lista.length}</b><span>aparelhos registrados</span></div><div class="card"><b>${ativos.length}</b><span><span class="ponto"></span>acessando agora</span></div></div>
<table><thead><tr><th>Nome</th><th>Aparelho</th><th>IP</th><th>Assistindo</th><th>Último acesso</th><th>Acessos</th><th>Primeiro acesso</th></tr></thead><tbody>${linhas || '<tr><td colspan="7">Nenhum acesso registrado ainda.</td></tr>'}</tbody></table>
</body></html>`);
});

return { central, CHAVE_CENTRAL, lerAcessos, gravarAcessos, ipDoPedido };
};
