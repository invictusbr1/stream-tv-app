const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
axios.defaults.timeout = 12000;
const app     = express();
const PORT    = process.env.PORT || 3000;
const LOCAL_CONFIG = (() => {
    const files = [path.join(process.cwd(), 'config.local.json'), path.join(path.dirname(process.execPath), 'config.local.json'), path.join(__dirname, 'config.local.json')];
    for (const file of files) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* configuração opcional */ } }
    return {};
})();
const LOCAL_AI_KEYS = (() => {
    const files = [
        process.env.STREAMTV_API_FILE,
        path.join(os.homedir(), 'OneDrive', 'Área de Trabalho', 'api.txt'),
        path.join(os.homedir(), 'Desktop', 'api.txt')
    ].filter(Boolean);
    for (const file of files) {
        try {
            const text = fs.readFileSync(file, 'utf8');
            const groq = text.match(/gsk_[A-Za-z0-9_-]{20,}/)?.[0] || '';
            const gemini = text.match(/AIza[A-Za-z0-9_-]{20,}/)?.[0] || '';
            if (groq || gemini) return { groq, gemini };
        } catch { /* arquivo local opcional */ }
    }
    return { groq: '', gemini: '' };
})();
const GROQ_KEY = process.env.GROQ_API_KEY || LOCAL_AI_KEYS.groq;
const GEMINI_KEY = process.env.GEMINI_API_KEY || LOCAL_AI_KEYS.gemini;
const PAGE_CANDIDATES = process.pkg
    ? [path.join(path.dirname(process.execPath), 'index.html'), path.join(__dirname, 'index.html')]
    : [path.join(__dirname, 'index.html')];

// ============================================================
// SEGURANÇA — cabeçalhos, CORS fechado, limite de uso e portão
// de entrada por código (usado quando o aplicativo é hospedado).
// ============================================================
// Onde ficam os dados locais (aparelhos autorizados, acessos, legendas).
// Em servidor/contêiner, DADOS_DIR aponta para um disco que sobrevive às
// atualizações; no computador, fica na pasta do próprio programa.
const DADOS_DIR = String(process.env.DADOS_DIR || '').trim()
    || (process.pkg ? path.dirname(process.execPath) : __dirname);
const ARQ_ACESSOS = path.join(DADOS_DIR, 'acessos.json');
const ARQ_LEGENDAS = path.join(DADOS_DIR, 'Legendas');

const seguranca = require('./seguranca');
const ACESSO_CODIGO = String(process.env.ACESSO_CODIGO || LOCAL_CONFIG.acessoCodigo || '').trim();
const ORIGENS_PERMITIDAS = String(process.env.ORIGENS_PERMITIDAS || LOCAL_CONFIG.origensPermitidas || '')
    .split(',').map(item => item.trim()).filter(Boolean);
app.set('trust proxy', true);
app.use(seguranca.cabecalhos({ origensPermitidas: ORIGENS_PERMITIDAS }));
app.use(express.json({ limit: '256kb' }));
app.use(seguranca.criarLimitador({
    janelaMs: Number(process.env.LIMITE_JANELA_MS || 60000),
    maximo: Number(process.env.LIMITE_PEDIDOS || 400),
    maximoMidia: Number(process.env.LIMITE_MIDIA || 3000),
    janelaMidiaMs: 600000
}));
const portao = seguranca.criarPortao({ codigo: ACESSO_CODIGO, arquivo: path.join(DADOS_DIR, 'autorizados.json') });
app.post('/api/entrar', (req, res) => portao.rotaEntrada(req, res));
app.use((req, res, next) => portao.middleware(req, res, next));

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
const JARVIS_PROVIDER = String(process.env.JARVIS_PROVIDER || 'groq').toLowerCase();
const JARVIS_SISTEMA = 'Você é o Jarvis do Conecta TV. Responda em português e nunca prometa que uma fonte funciona.';
// Se o provedor aposentar um modelo, o Jarvis tenta o próximo da lista antes de responder erro.
const JARVIS_PREFERIDOS = {
    groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'],
    gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
};
const MODELO_NAO_CONVERSA = /whisper|guard|orpheus|tts|embedding|moderation/i;
const jarvisUsage = new Map();
let cacheModelosGroq = null;
async function modelosGroqDisponiveis() {
    if (cacheModelosGroq) return cacheModelosGroq;
    try {
        const r = await axios.get('https://api.groq.com/openai/v1/models', { timeout: 8000, headers: { Authorization: `Bearer ${GROQ_KEY}` } });
        cacheModelosGroq = (r.data?.data || []).map(modelo => modelo.id).filter(id => !MODELO_NAO_CONVERSA.test(id));
    } catch { cacheModelosGroq = []; }
    return cacheModelosGroq;
}
async function modelosJarvis(provider) {
    const escolhido = String(process.env.JARVIS_MODEL || '').trim();
    const ordem = [...(escolhido && JARVIS_PROVIDER === provider ? [escolhido] : []), ...(JARVIS_PREFERIDOS[provider] || [])];
    if (provider !== 'groq') return [...new Set(ordem)];
    const disponiveis = await modelosGroqDisponiveis();
    const conhecidos = ordem.filter(modelo => !disponiveis.length || disponiveis.includes(modelo));
    return [...new Set([...conhecidos, ...disponiveis.filter(id => !conhecidos.includes(id))])].slice(0, 4);
}
app.post('/api/jarvis', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 1200) : '';
    if (!prompt) return res.status(400).json({ error: 'Escreva o que deseja encontrar.' });
    const ip = String(req.ip || 'unknown').slice(0, 80), now = Date.now();
    const usage = jarvisUsage.get(ip) || { started: now, count: 0 };
    if (now - usage.started > 86400000) { usage.started = now; usage.count = 0; }
    if (usage.count >= 40) return res.status(429).json({ error: 'Limite gratuito diário atingido. Tente novamente amanhã.' });
    usage.count++; jarvisUsage.set(ip, usage);
    const providers = JARVIS_PROVIDER === 'gemini' ? ['gemini', 'groq'] : ['groq', 'gemini'];
    const available = providers.filter(provider => provider === 'gemini' ? GEMINI_KEY : GROQ_KEY);
    if (!available.length) return res.status(503).json({ error: 'Jarvis ainda não foi configurado neste servidor.' });
    for (const provider of available) {
        for (const model of await modelosJarvis(provider)) {
            try {
                let answer;
                if (provider === 'gemini') {
                    const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, { contents: [{ role: 'user', parts: [{ text: `${JARVIS_SISTEMA}\n\n${prompt}` }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 700 } }, { timeout: 20000 });
                    answer = r.data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
                } else {
                    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model, temperature: 0.6, max_tokens: 900, messages: [{ role: 'system', content: JARVIS_SISTEMA }, { role: 'user', content: prompt }] }, { timeout: 20000, headers: { Authorization: `Bearer ${GROQ_KEY}` } });
                    answer = r.data?.choices?.[0]?.message?.content?.trim();
                }
                if (answer) return res.json({ answer, provider, model });
            } catch { if (provider === 'groq') cacheModelosGroq = null; /* modelo aposentado: reconsulta a lista */ }
        }
    }
    res.status(502).json({ error: 'O Jarvis está indisponível no momento. Nenhuma cobrança foi iniciada pelo Conecta TV.' });
});
app.get(['/','/index.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    for (const file of PAGE_CANDIDATES) {
        try { return res.type('html').send(require('./pwa/page.cjs').webPage(fs.readFileSync(file, 'utf8'))); } catch { /* tenta o próximo local */ }
    }
    res.status(500).send('Interface do Conecta TV não encontrada.');
});
app.get('/manifest.webmanifest',(req,res)=>res.type('application/manifest+json').sendFile(path.join(__dirname,'pwa/manifest.webmanifest')));
app.get('/sw.js',(req,res)=>{res.setHeader('Cache-Control','no-cache');res.type('js').sendFile(path.join(__dirname,'pwa/sw.js'));});
app.get(['/pwa/install.js','/pwa/icon-180.png','/pwa/icon-192.png','/pwa/icon-512.png'],(req,res)=>res.sendFile(path.join(__dirname,req.path)));
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'stream-tv' }));

// ============================================================
// CENTRAL DE STATUS — o aplicativo conta o que foi aberto. A central
// é opcional e nunca atrasa o player: se ela não responder, seguimos.
// ============================================================
const central = require('./central-reporter');
app.post('/api/evento', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // O player avisou que a fonte abriu mas não tocou: o motor aprende com
    // isso (a fonte sai da frente neste título e perde prioridade no geral).
    try {
        const corpo = req.body || {};
        if (corpo.tipo === 'falha' && corpo.fonteId) {
            const motor = require('./fontes-motor');
            const ehEpisodio = Boolean(corpo.temporada && corpo.numero);
            const alvo = motor.alvoDoEvento(ehEpisodio ? 'tv' : 'movie', corpo.id, corpo.temporada, corpo.numero);
            motor.registrarFalha(corpo.fonteId, corpo.motivo, alvo ? `dublado:${motor.chaveDoTitulo(alvo)}` : '');
        }
    } catch { /* o aviso para a central segue normalmente */ }
    if (!central.configurada()) return res.json({ ok: true, central: false });
    const enviado = await central.reportar(req.body || {}).catch(() => false);
    res.json({ ok: true, central: enviado });
});

// ============================================================
// REGISTRO DE ACESSOS — quem entrou, de qual aparelho e de qual IP
// Os dados ficam num arquivo ao lado do aplicativo e aparecem na central.
// ============================================================
// Sem chave configurada, esta tela não abre (nada de senha padrão).
const CHAVE_CENTRAL = String(process.env.CENTRAL_KEY || LOCAL_CONFIG.centralKey || '').trim();

function lerAcessos() {
    try { return JSON.parse(fs.readFileSync(ARQ_ACESSOS, 'utf8')) || {}; } catch { return {}; }
}

function gravarAcessos(lista) {
    try { fs.writeFileSync(ARQ_ACESSOS, JSON.stringify(lista, null, 1), 'utf8'); } catch { /* sem permissão de escrita */ }
}

function ipDoPedido(req) {
    const encaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const direto = req.socket?.remoteAddress || '';
    return (encaminhado || direto).replace(/^::ffff:/, '');
}

app.post('/api/acesso', (req, res) => {
    const corpo = req.body || {};
    const nome = String(corpo.nome || '').trim().slice(0, 60);
    if (!nome) return res.status(400).json({ error: 'Informe o nome para usar o aplicativo.' });
    const dispositivo = String(corpo.dispositivo || '').slice(0, 40) || ('ip-' + ipDoPedido(req));
    const lista = lerAcessos();
    const anterior = lista[dispositivo] || {};
    const agora = new Date().toISOString();
    lista[dispositivo] = {
        dispositivo,
        nome,
        aparelho: String(corpo.aparelho || 'Aparelho').slice(0, 40),
        versao: String(corpo.versao || '').slice(0, 20),
        assistindo: corpo.assistindo ? String(corpo.assistindo).slice(0, 90) : (anterior.assistindo || null),
        ip: ipDoPedido(req),
        primeiroEm: anterior.primeiroEm || agora,
        ultimoEm: agora,
        vezes: Number(anterior.vezes || 0) + 1
    };
    gravarAcessos(lista);
    // Repassa para a central de status (quando configurada).
    require('./central-reporter').reportarAcesso(lista[dispositivo]).catch(() => {});
    const pessoas = new Set(Object.values(lista).map(item => item.nome.toLowerCase())).size;
    console.log(`[acesso] ${nome} · ${lista[dispositivo].aparelho} · ${lista[dispositivo].ip}`);
    res.json({ ok: true, pessoas, aparelhos: Object.keys(lista).length });
});

app.get('/central', (req, res) => {
    if (CHAVE_CENTRAL.length < 8 || String(req.query.chave || '') !== CHAVE_CENTRAL) {
        res.status(401).type('html').send('<!doctype html><meta charset="utf-8"><body style="background:#0b0e15;color:#e8ecf3;font:16px system-ui;padding:40px">Acesso restrito. Use <code>/central?chave=SUA-CHAVE</code>.</body>');
        return;
    }
    const lista = Object.values(lerAcessos()).sort((a, b) => String(b.ultimoEm).localeCompare(String(a.ultimoEm)));
    const agora = Date.now();
    const ativos = lista.filter(item => agora - new Date(item.ultimoEm).getTime() < 5 * 60 * 1000);
    const pessoas = new Set(lista.map(item => item.nome.toLowerCase())).size;
    const linhas = lista.map(item => {
        const minutos = Math.round((agora - new Date(item.ultimoEm).getTime()) / 60000);
        const visto = minutos < 1 ? 'agora' : minutos < 60 ? `há ${minutos} min` : minutos < 1440 ? `há ${Math.round(minutos / 60)} h` : `há ${Math.round(minutos / 1440)} dia(s)`;
        return `<tr><td>${item.nome}</td><td>${item.aparelho}</td><td>${item.ip || '-'}</td><td>${item.assistindo || '-'}</td><td>${visto}</td><td>${item.vezes || 1}</td><td>${String(item.primeiroEm).slice(0, 16).replace('T', ' ')}</td></tr>`;
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
        const legendasOnline = require('./legendas-online');
        let imdb = String(req.query.imdb || '').trim();
        if (!/^tt\d{5,10}$/i.test(imdb) && /^\d{1,10}$/.test(String(req.query.id || ''))) {
            imdb = String(await getImdbId(String(req.query.id)).catch(() => '') || '');
        }
        const encontradas = imdb ? await legendasOnline.listar(imdb) : [];
        res.json({ fonte: 'YIFY', imdb, encontradas });
    } catch (erro) {
        res.status(502).json({ error: 'Não foi possível buscar as legendas agora.', encontradas: [] });
    }
});

// Baixa a legenda escolhida e guarda uma cópia na pasta do aplicativo — na
// próxima vez ela já entra como legenda local, mesmo sem internet.
app.get('/api/legenda-online', async (req, res) => {
    try {
        const legendasOnline = require('./legendas-online');
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

// ============================================================
app.get('/hls.min.js', (req, res) => res.type('js').send(fs.readFileSync(path.join(__dirname, 'node_modules/hls.js/dist/hls.min.js'))));
// O player vai sem cache: a atualização vale na hora, sem o navegador ficar
// com a versão antiga guardada.
app.get('/playback.js', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('js').send(fs.readFileSync(path.join(__dirname, 'playback.js'))); });

// ============================================================
// ENCAMINHAMENTO DO VÍDEO — o provedor de mídia exige um "referer"
// próprio que o navegador não consegue enviar. O aplicativo busca o
// vídeo no servidor e repassa ao player, sem abrir páginas externas
// (ou seja: sem anúncio no caminho do usuário).
// ============================================================
const midia = require('./midia-proxy');
app.get('/api/hls', async (req, res) => {
    let endereco;
    let referer = '';
    let pai = '';
    try {
        endereco = new URL(midia.textoDeBase64url(req.query.u));
        if (req.query.r) referer = midia.textoDeBase64url(req.query.r);
        if (req.query.p) pai = midia.textoDeBase64url(req.query.p);
    } catch {
        return res.sendStatus(400);
    }
    // Só https, só host conhecido e nunca a rede de casa (proteção contra SSRF).
    if (endereco.protocol !== 'https:' || !midia.hostPermitido(endereco.hostname) || seguranca.hostInterno(endereco.hostname)) return res.sendStatus(403);
    const cabecalhosBase = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: '*/*'
    };
    if (req.headers.range) cabecalhosBase.Range = req.headers.range;
    // Alguns provedores só liberam o vídeo quando o pedido vem da própria página
    // do player. Tenta o endereço de origem informado e, se falhar, o endereço que
    // indicou o vídeo.
    const tentativas = [...new Set([referer, pai, midia.refererPadrao(endereco.hostname)].filter(Boolean))];
    if (!tentativas.length) tentativas.push('');
    let resposta = null;
    for (const referencia of tentativas) {
        const cabecalhos = { ...cabecalhosBase };
        if (referencia) {
            cabecalhos.Referer = referencia;
            try { cabecalhos.Origin = new URL(referencia).origin; } catch { /* referer sem origem */ }
        }
        try {
            const r = await fetch(endereco.href, { headers: cabecalhos, redirect: 'follow' });
            if (r.ok || r.status === 206 || tentativas.length === 1) { resposta = { r, referencia }; break; }
        } catch { /* tenta a próxima referência */ }
    }
    if (!resposta) return res.sendStatus(502);
    const { r: respostaFinal, referencia: referenciaFinal } = resposta;
    try {
        const tipo = String(respostaFinal.headers.get('content-type') || '');
        const ehLista = /mpegurl|m3u8/i.test(tipo) || /\.m3u8$/i.test(endereco.pathname);
        if (ehLista) {
            const texto = await respostaFinal.text();
            // O provedor pode ter redirecionado a lista para outro servidor:
            // libera também o endereço final antes de reescrever os pedaços.
            try { midia.liberarHost(new URL(respostaFinal.url || endereco.href).hostname.toLowerCase()); } catch { /* endereço estranho */ }
            // A lista pode apontar para servidores de vídeo de outros domínios
            // (é assim no FenixFlix: a lista vem de um endereço e os pedaços do
            // filme vêm de outro). Como a lista veio de uma fonte já autorizada,
            // liberamos os domínios que ELA indica — sem isso o navegador tenta
            // falar direto com eles e o vídeo não abre.
            for (const achado of texto.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
                try { midia.liberarHost(achado[1].toLowerCase()); } catch { /* endereço estranho */ }
            }
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(midia.reescreverPlaylist(texto, respostaFinal.url || endereco.href, referenciaFinal));
        }
        res.status(respostaFinal.status);
        for (const nome of ['content-type', 'content-length', 'accept-ranges', 'content-range', 'last-modified', 'etag']) {
            const valor = respostaFinal.headers.get(nome);
            if (valor) res.setHeader(nome, valor);
        }
        if (!respostaFinal.body) return res.end();
        const { Readable } = require('stream');
        return Readable.fromWeb(respostaFinal.body).pipe(res);
    } catch {
        res.sendStatus(502);
    }
});

app.get('/api/playback/:id', async (req, res) => {
    if (!/^\d{1,10}$/.test(req.params.id)) return res.sendStatus(400);
    res.setHeader('Cache-Control', 'no-store');
    // O motor escolhe a fonte dublada limpa (e lembra qual deu certo).
    try {
        const motor = require('./fontes-motor');
        const avaliador = require('./avaliador');
        const exceto = String(req.query.exceto || '').split(',').map(item => item.trim()).filter(Boolean);
        const alvo = { tipo: 'movie', tmdbId: req.params.id };
        // Avaliador em tempo real: testa as melhores fontes do título em
        // paralelo e escolhe a que entrega mais qualidade seguindo as regras.
        let escolhido = null;
        let avaliacao = null;
        if (process.env.AVALIADOR !== '0') {
            const resultado = await avaliador.escolherMelhor('dublado', alvo, { exceto }).catch(() => null);
            if (resultado) { escolhido = resultado.escolhido; avaliacao = resultado.avaliacao; }
        }
        if (!escolhido) escolhido = await motor.escolher('dublado', alvo, { exceto });
        if (escolhido) {
            // A decisão do avaliador fica registrada na central (alimenta a
            // evolução das fontes com a escolha real do momento).
            if (avaliacao) {
                try {
                    require('./central-reporter').reportar({
                        tipo: 'avaliacao', id: String(req.params.id), titulo: '',
                        fonte: escolhido.fonte || '', fonteId: escolhido.fonteId || '',
                        // Quem pediu: o crachá do aparelho identifica o relato
                        // (antes chegava como "Anônimo" na central).
                        ...(req.dispositivoAutorizado ? {
                            nome: req.dispositivoAutorizado.nome || 'Anônimo',
                            aparelho: req.dispositivoAutorizado.aparelho || '',
                            dispositivo: req.dispositivoAutorizado.dispositivo || '',
                        } : {}),
                        avaliacao: avaliacao.map(a => ({ fonte: a.fonteId, nota: a.nota, idioma: a.detalhes && a.detalhes.idioma, qualidade: a.detalhes && a.detalhes.qualidade, taxa: a.detalhes && a.detalhes.taxa })),
                    }).catch(() => {});
                } catch { /* central é opcional */ }
            }
            // Fonte que precisa de conversão (MKV com som que o navegador não
            // toca): o aplicativo converte e só o áudio muda; a imagem é a
            // original, sem perda.
            if (escolhido.converter) {
                const conversor = require('./conversor');
                const trabalho = await conversor.iniciar(escolhido.url, { titulo: `filme-${req.params.id}`, referer: escolhido.referer || '' });
                return res.json({
                    url: `/api/convertido/${trabalho.id}/index.m3u8`,
                    audio: escolhido.audio || 'pt-BR',
                    source: escolhido.fonte || 'Dublado (conversão)',
                    type: 'hls',
                    resolucao: escolhido.resolucao || '',
                    conversao: trabalho.id,
                });
            }
            const pronto = motor.prepararParaPlayer(escolhido);
            return res.json({
                url: pronto.final ? pronto.url : pronto.urlAplicativo,
                audio: pronto.audio || 'pt-BR',
                source: pronto.fonte || 'Dublado limpo',
                fonteId: pronto.fonteId || '',
                type: pronto.type || 'hls',
                resolucao: pronto.resolucao || '',
                avaliacao: avaliacao || undefined,
            });
        }
    } catch { /* segue para o aviso */ }
    res.status(502).json({ error: 'Reprodução direta dublada indisponível.' });
});

// ============================================================
// EPISÓDIOS — o robô procura sozinho a melhor opção, na ordem da regra do
// aplicativo: primeiro dublado e limpo; depois alta definição limpa, com
// legenda em português quando a fonte tiver. Sempre entregue pelo próprio
// aplicativo, então nada abre em página de terceiros e não há anúncio.
// A sessão da fonte dublada (opcional) vem de config.local.json
// (watchplayCookie) ou da variável WATCHPLAY_COOKIE.
// ============================================================
app.get('/api/playback/serie/:id/:season/:episode', async (req, res) => {
    // (a rota usa o conversor quando a fonte só existe em arquivo que o
    // navegador toca mudo — ver abaixo)
    const { id, season, episode } = req.params;
    if (!/^\d{1,10}$/.test(id) || !/^\d{1,3}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode)) return res.sendStatus(400);
    res.setHeader('Cache-Control', 'no-store');
    const cookie = process.env.WATCHPLAY_COOKIE || LOCAL_CONFIG.watchplayCookie || '';
    try {
        const exceto = String(req.query.exceto || '').split(',').map(item => item.trim()).filter(Boolean);
        const alvo = { tipo: 'tv', tmdbId: id, temporada: season, episodio: episode };
        let escolhido = null;
        let avaliacao = null;
        if (process.env.AVALIADOR !== '0') {
            const resultado = await require('./avaliador').escolherMelhor('dublado', alvo, { exceto }).catch(() => null);
            if (resultado) {
                escolhido = require('./fontes-motor').prepararParaPlayer(resultado.escolhido);
                avaliacao = resultado.avaliacao;
            }
        }
        if (!escolhido) escolhido = await require('./series-source').resolverEpisodio({ tmdbId: id, temporada: season, episodio: episode, cookie, exceto });
        if (!escolhido) throw new Error('sem fonte');
        if (escolhido.converter) {
            const conversor = require('./conversor');
            const trabalho = await conversor.iniciar(escolhido.url, { titulo: `serie-${id}-T${season}E${episode}`, referer: escolhido.referer || '' });
            return res.json({
                url: `/api/convertido/${trabalho.id}/index.m3u8`,
                audio: escolhido.audio || 'pt-BR',
                source: escolhido.fonte || 'Dublado (conversão)',
                type: 'hls',
                resolucao: escolhido.resolucao || '',
                conversao: trabalho.id,
            });
        }
        res.json({
            // Fonte de arquivo direto (dublada) não passa pelo encaminhamento.
            url: escolhido.final ? escolhido.url : escolhido.urlAplicativo,
            audio: escolhido.audio,
            source: escolhido.fonte,
            fonteId: escolhido.fonteId || '',
            type: escolhido.type || 'hls',
            resolucao: escolhido.resolucao,
            legendas: escolhido.legendas || [],
            legendaPortugues: Boolean(escolhido.legendaPortugues),
            avaliacao: avaliacao || undefined,
        });
    } catch {
        res.status(502).json({ error: 'Nenhuma fonte limpa respondeu para este episódio agora.' });
    }
});

// ------------------------------------------------------------
// CONVERSÃO DE ARQUIVO — para provedores que entregam MKV com som que o
// navegador não toca. O vídeo é copiado (sem perda) e o áudio vira AAC.
// ------------------------------------------------------------
app.get('/api/converter', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let endereco = '';
    try { endereco = midia.textoDeBase64url(req.query.url || ''); } catch { return res.status(400).json({ erro: 'endereço inválido' }); }
    // Aceita https de fora e o endereço local (127.0.0.1) — este último serve
    // para conferir conversões de arquivos guardados no próprio computador.
    const ehLocal = /^http:\/\/127\.0\.0\.1(:\d+)?\//i.test(endereco);
    const bloqueado = seguranca.hostInterno(new URL(endereco).hostname) && !ehLocal;
    if ((!ehLocal && !/^https:\/\//i.test(endereco)) || bloqueado) return res.status(400).json({ erro: 'endereço inválido' });
    try {
        const conversor = require('./conversor');
        const trabalho = await conversor.iniciar(endereco, {
            titulo: String(req.query.titulo || 'video').slice(0, 60),
            referer: String(req.query.referer || '').slice(0, 200),
        });
        res.json({ ok: true, ...trabalho });
    } catch (erro) {
        res.status(502).json({ erro: String(erro.message).slice(0, 120) });
    }
});

app.get('/api/conversao/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const conversor = require('./conversor');
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
        const resultado = await require('./avaliador').escolherMelhor('dublado', alvo, { semCache: true, exceto: String(req.query.exceto || '').split(',').filter(Boolean) });
        if (!resultado) return res.json({ ok: false, motivo: 'nenhuma fonte respondeu' });
        res.json({ ok: true, tempoMs: resultado.tempoMs, melhor: resultado.escolhido.fonteId, avaliacao: resultado.avaliacao });
    } catch (erro) {
        res.status(502).json({ erro: String(erro.message).slice(0, 120) });
    }
});

// Entrega o arquivo em conversão (com suporte a avançar/voltar, quando o
// trecho pedido já foi convertido).
app.get('/api/convertido/:id', (req, res) => {
    const conversor = require('./conversor');
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
    const conversor = require('./conversor');
    const nome = String(req.params.pedaco || '');
    const arquivo = conversor.caminhoDoPedaço(String(req.params.id || ''), nome);
    if (!arquivo) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', /\.m3u8$/i.test(nome) ? 'application/vnd.apple.mpegurl' : /\.ts$/i.test(nome) ? 'video/mp2t' : 'application/octet-stream');
    return fs.createReadStream(arquivo).pipe(res);
});

// ============================================================
// FULL HD SEM ANÚNCIO — resolvedor do Vixsrc (endereço direto do vídeo).
// Usado como opção de melhor qualidade; o áudio é o da fonte (normalmente original).
// ============================================================
app.get('/api/stream-hd', async (req, res) => {
    const tipo = String(req.query.tipo || 'movie') === 'tv' ? 'tv' : 'movie';
    const id = String(req.query.id || '');
    const temporada = String(req.query.season || '1');
    const episodio = String(req.query.episode || '1');
    if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ ok: false });
    res.setHeader('Cache-Control', 'no-store');
    // O motor tenta as fontes de alta definição na ordem que ele aprendeu.
    try {
        const motor = require('./fontes-motor');
        const alvo = { tipo, tmdbId: id, temporada, episodio };
        const escolhido = await motor.escolher('hd', alvo);
        if (escolhido) {
            const pronto = motor.prepararParaPlayer(escolhido);
            res.json({
                ok: true,
                url: pronto.final ? pronto.url : (pronto.urlAplicativo || pronto.url),
                urlAplicativo: pronto.final ? pronto.url : pronto.urlAplicativo,
                qualidade: pronto.resolucao || 'Full HD',
                legendas: pronto.legendas || [],
                legendaPortugues: Boolean(pronto.legendaPortugues),
                fonte: pronto.fonte || 'Alta definição'
            });
            return;
        }
    } catch { /* sem fonte de alta definição */ }
    res.json({ ok: false, motivo: 'Fonte Full HD indisponível para este título.' });
});

const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';

// Diagnóstico do motor de fontes: quais estão saudáveis agora.
app.get('/api/motor/estado', (req, res) => res.json({ fontes: require('./fontes-motor').estado() }));

// ============================================================
// TV AO VIVO — canais das listas públicas (iptv-org) que o caçador
// da central aprovou com nota acima de 8.
// ============================================================
const tvAoVivo = require('./tv-ao-vivo');
app.get('/api/tv/listas', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ listas: tvAoVivo.LISTAS.map(l => ({ id: l.id, nome: l.nome, nota: l.nota })) });
});
app.get('/api/tv/canais', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const lista = String(req.query.lista || 'brasil').slice(0, 20);
        const canais = await tvAoVivo.canais(lista);
        const busca = String(req.query.q || '').toLowerCase().slice(0, 40);
        const filtrados = busca ? canais.filter(c => c.nome.toLowerCase().includes(busca) || c.grupo.toLowerCase().includes(busca)) : canais;
        res.json({ lista, total: filtrados.length, canais: filtrados.slice(0, 400) });
    } catch {
        res.status(502).json({ error: 'Não foi possível carregar os canais agora.' });
    }
});

// Categorias (grupos) dos canais da lista escolhida — é o que alimenta as
// abas de categoria na tela de TV ao vivo.
app.get('/api/tv/categorias', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const lista = String(req.query.lista || 'brasil').slice(0, 20);
        const canais = await tvAoVivo.canais(lista);
        const contagem = new Map();
        for (const canal of canais) {
            const grupo = (canal.grupo || 'Outros').trim() || 'Outros';
            contagem.set(grupo, (contagem.get(grupo) || 0) + 1);
        }
        const categorias = [...contagem.entries()]
            .map(([nome, total]) => ({ nome, total }))
            .sort((a, b) => b.total - a.total);
        res.json({ lista, total: canais.length, categorias });
    } catch {
        res.status(502).json({ error: 'Não foi possível listar as categorias agora.' });
    }
});

const libraryCatalog=require('./android/app/src/main/assets/catalog').createCatalog(async (url,options)=>{const r=await axios.get(url,{signal:options?.signal});return {ok:true,json:async()=>r.data};},TMDB_KEY);
app.get(['/api/explore','/api/genres','/api/top-br','/api/alta',/^\/api\/(tv|season|episode)\//],async(req,res)=>{try{res.json(await libraryCatalog.request(req.originalUrl));}catch{res.status(502).json({error:'Catálogo indisponível'});}});
app.get('/personal.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.sendFile(path.join(__dirname,'personal.js'));});
app.get('/library.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(__dirname,'library.js')));});
app.get('/auth.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(__dirname,'auth.js')));});
app.get('/jarvis.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(__dirname,'jarvis.js')));});
app.get('/fontes.json',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('json').sendFile(path.join(__dirname,'fontes.json'));});
app.get('/acesso.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(__dirname,'acesso.js')));});
app.get('/legendas.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(__dirname,'legendas.js')));});

app.get('/assistir.html',(req,res)=>res.type('html').send(fs.readFileSync(path.join(__dirname,'android/app/src/main/assets/assistir.html'))));
app.get('/catalog.js',(req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'android/app/src/main/assets/catalog.js'))));
// A página de reprodução com anúncios usa este arquivo; sem a rota ele
// respondia 404 e a página perdia os controles no computador.
app.get('/android.js',(req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'android/app/src/main/assets/android.js'))));
app.get('/config.json',(req,res)=>res.json({
    tmdbKey: TMDB_KEY,
    app: 'desktop',
    versionName: (() => { try { return require('./package.json').version; } catch { return ''; } })(),
    // O anon key do Supabase é público por desenho; chaves de serviço nunca são enviadas ao cliente.
    supabaseUrl: process.env.SUPABASE_URL || LOCAL_CONFIG.supabaseUrl || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || LOCAL_CONFIG.supabaseAnonKey || '',
    // Endereço da central de status (opcional). O aplicativo reporta acessos e sessões para lá.
    central: String(process.env.CENTRAL_URL || LOCAL_CONFIG.central || '').replace(/\/$/, '')
}));

const OSCAR_SELECTION = [
    238, 240, 424, 13, 122, 497, 680, 389, 11216, 244786,
    129, 857, 313369,
];

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function mapFilme(f) {
    return {
        id:      f.id,
        titulo:  f.title || f.name,
        sinopse: f.overview || '',
        nota:    f.vote_average ? Number(f.vote_average).toFixed(1) : 'N/A',
        ano:     (f.release_date || f.first_air_date || '').substring(0, 4),
        capa:    f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : '',
        fundo:   f.backdrop_path ? `https://image.tmdb.org/t/p/w1280${f.backdrop_path}` : '',
        popularidade: Number(f.popularity || 0),
        votos:   Number(f.vote_count || 0),
    };
}

async function tmdbGet(url) {
    const cached = CACHE.get(url);
    if (cached && cached.expires > Date.now()) return cached.value;
    const r = await axios.get(url, { timeout: 15000 });
    CACHE.set(url, { value: r.data, expires: Date.now() + CACHE_TTL });
    return r.data;
}

async function descobrir(params) {
    const query = new URLSearchParams({ api_key: TMDB_KEY, language: 'pt-BR', include_adult: 'false', page: '1', ...params });
    const data = await tmdbGet(`https://api.themoviedb.org/3/discover/movie?${query}`);
    return (data.results || []).map(mapFilme);
}

async function oscarPremiados() {
    const data = await Promise.all(OSCAR_SELECTION.map(async id => {
        try { return mapFilme(await tmdbGet(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=pt-BR`)); }
        catch { return null; }
    }));
    return data.filter(Boolean).sort((a, b) => Number(b.nota === 'N/A' ? 0 : b.nota) - Number(a.nota === 'N/A' ? 0 : a.nota));
}

const H = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Upgrade-Insecure-Requests': '1',
};

// ============================================================
// FONTES — atualizado em 06/10/2026 com teste em navegador real
//
// ATIVAS (entregaram vídeo no teste):
//   PipocaCine → 720p, faixas de áudio PT e EN. Tem anúncio: só como último caso.
//   VidLink    → 1080p (HEVC), a única opção Full HD encontrada. Tem anúncio.
//
// DESLIGADAS (dub:false e sem optional): ficam fora da lista do aplicativo.
//   watchcdn, cdn-embed, ultraembed → página vazia ou anúncio, sem vídeo
//   vidsrc.me, autoembed, moviesapi, vidsrc.in → resposta vazia, erro ou anúncio
//   vidsrc.wtf, vidfast, vidbinge, 2embed, multiembed, videasy, nontongo, 111movies,
//   embed.su, vidjoy, smashy, filmxy, vidsrc.to, vidsrc.net, vidsrc.mov, vidora.su
//     → Cloudflare, verificação humana ou pop-up de anúncio; nenhum entregou vídeo limpo
//   superflixapi.monster, streambetter.shop → pedem confirmação humana ("não sou robô")
//
// REGRA DO PROJETO: fonte sem anúncio primeiro; anúncio somente como último caso,
// sempre fora do aplicativo, na janela separada do modo com anúncios.
// ============================================================
function getFontes(filmeId, imdbId) {
    const imdb = imdbId || filmeId; // fallback para tmdb se sem imdb
    return [

        // ── Último caso: abre em janela separada para os anúncios da fonte ──
        {
            nome:     'PipocaCine (720p · PT e original)',
            url:      `https://pipocacine.lat/embed/${filmeId}`,
            referer:  'https://pipocacine.lat/',
            dub:      false,
            optional: true,
            comAnuncios: true,
            qualidade:'720p · áudio PT e EN',
            modo:     'direto',
            timeout:  8000,
        },
        {
            nome:     'VidLink (Full HD)',
            url:      `https://vidlink.pro/movie/${filmeId}`,
            referer:  'https://vidlink.pro/',
            dub:      false,
            optional: true,
            comAnuncios: true,
            qualidade:'1080p (HEVC)',
            modo:     'direto',
            timeout:  8000,
        },

        // ── Desligadas: não entregaram vídeo em 06/10/2026 ────
        {
            nome:    'WatchCDN (indisponível)',
            url:     `https://embed.watchcdn.org/filme/${imdb}`,
            referer: 'https://watchcdn.org/',
            dub:     false,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'CdnEmbed (somente anúncio)',
            url:     `https://cdn-embed.com/filme/${filmeId}`,
            referer: 'https://embedmovies.org/',
            dub:     false,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'UltraEmbed (indisponível)',
            url:     `https://ultraembed.com/filme/${imdb}`,
            referer: 'https://ultraembed.com/',
            dub:     false,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'VidSrc.me (indisponível)',
            url:     `https://vidsrc.me/embed/movie?tmdb=${filmeId}`,
            referer: 'https://vidsrc.me/',
            dub:     false,
            modo:    'proxy',
            timeout: 10000,
        },
        {
            nome:    'AutoEmbed (somente anúncio)',
            url:     `https://autoembed.co/movie/tmdb/${filmeId}`,
            referer: 'https://autoembed.co/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
        {
            nome:    'MoviesAPI (indisponível)',
            url:     `https://moviesapi.club/movie/${filmeId}`,
            referer: 'https://moviesapi.club/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
        {
            nome:    'VidSrc.in (indisponível)',
            url:     `https://vidsrc.in/embed/movie?tmdb=${filmeId}`,
            referer: 'https://vidsrc.in/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
    ];
}

// ============================================================
// BUSCA IMDB ID pelo TMDB ID
// Necessário para fontes que usam IMDB (watchcdn, ultraembed)
// ============================================================
async function getImdbId(tmdbId) {
    try {
        const r = await axios.get(
            `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`,
            { timeout: 5000 }
        );
        return r.data.imdb_id || null; // ex: "tt1234567"
    } catch {
        return null;
    }
}

// ============================================================
// Detectores de bloqueio — fontes com esses padrões são descartadas
// ============================================================
const BLOQUEIOS = [
    'challenges.cloudflare.com',
    'captcha-gate',
    'hcaptcha.com',
    'recaptcha',
    'disable-devtool',
    'turnstile',
    'ZpQw9XkLmN8',
    "window['",
    'atob(',
];

const ERROS_HTML = ['not found', 'not available', 'access denied', 'forbidden', '404 error'];

// ============================================================
// Testa fontes proxy (baixa HTML e valida)
// ============================================================
async function testarProxy(fonte) {
    try {
        const r = await axios.get(fonte.url, {
            headers: { ...H, 'Referer': fonte.referer, 'Origin': new URL(fonte.url).origin },
            responseType:   'text',
            timeout:        fonte.timeout,
            maxRedirects:   10,
            validateStatus: s => s === 200,
        });

        const html = r.data || '';
        if (!r.headers['content-type']?.includes('text/html')) return { ok: false, motivo: 'não é HTML' };
        if (html.length < 400) return { ok: false, motivo: 'resposta vazia' };

        for (const b of BLOQUEIOS) {
            if (html.includes(b)) return { ok: false, manual: true, motivo: 'Esta fonte precisa ser aberta no navegador para verificação' };
        }

        const low = html.toLowerCase();
        for (const e of ERROS_HTML) {
            if (low.includes(e) && html.length < 5000) return { ok: false, motivo: `erro: ${e}` };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, manual: [401, 403, 429, 503].includes(err.response?.status), motivo: err.code || err.message };
    }
}

// ============================================================
// Testa fontes diretas (só verifica se domínio responde)
// ============================================================
async function testarDireto(fonte) {
    try {
        const r = await axios.get(fonte.url, {
            headers:        { ...H, 'Referer': fonte.referer },
            timeout:        fonte.timeout,
            maxRedirects:   5,
            responseType:   'text',
            maxContentLength: 2 * 1024 * 1024,
            validateStatus: s => s >= 200 && s < 300,
        });
        const html = String(r.data || '').trim();
        if (!r.headers['content-type']?.includes('text/html')) return { ok: false, motivo: 'Resposta não é uma página de vídeo' };
        if (html.length < 400) return { ok: false, motivo: 'Fonte retornou uma página vazia' };
        if (/challenges\.cloudflare\.com|hcaptcha\.com|captcha-gate|turnstile|recaptcha/i.test(html)) return { ok: false, manual: true, motivo: 'Fonte exige verificação no navegador' };
        if (ERROS_HTML.some(e => html.toLowerCase().includes(e)) && html.length < 5000) return { ok: false, motivo: 'Conteúdo indisponível na fonte' };
        return { ok: true };
    } catch (err) {
        return { ok: false, manual: [401, 403, 429, 503].includes(err.response?.status), motivo: err.code || err.message };
    }
}

// ============================================================
// Limpa HTML antes de servir (fontes proxy)
// ============================================================
function limparHtml(html, baseUrl) {
    html = html.replace(
        /<script[^>]+src=["'][^"']*(?:popads|popcash|adsterra|adnxs|histats|doubleclick|googlesyndication|amazon-adsystem)[^"']*["'][^>]*><\/script>/gi, ''
    );
    html = html.replace(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi, (match, code) => {
        const low = code.toLowerCase();
        if (low.includes('window.open(') || low.includes('location.replace(') ||
            (low.includes('window.location') && low.includes('=') && !low.includes('addeventlistener'))) {
            return '<!-- removido -->';
        }
        return match;
    });
    html = html.replace(/<meta[^>]*http-equiv=["'](?:X-Frame-Options|Content-Security-Policy)["'][^>]*>/gi, '');
    if (/<head/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}/">`);
    } else {
        html = `<base href="${baseUrl}/">` + html;
    }
    return html;
}

// ============================================================
// ROTA 1 — Em alta
// ============================================================
app.get('/api/em-alta', async (req, res) => {
    try {
        const r = await tmdbGet(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=pt-BR&page=1`);
        res.json((r.results || []).map(mapFilme));
    } catch (e) { res.status(500).json([]); }
});

// ============================================================
// ROTA 1B — Rankings para a tela inicial
// ============================================================
app.get('/api/rankings', async (req, res) => {
    try {
        res.json(await libraryCatalog.request(req.originalUrl));
    } catch (e) {
        console.error('[rankings] falha:', e.message);
        res.status(502).json({ error: 'Não foi possível carregar os rankings.' });
    }
});

// ============================================================
// ROTA 2 — Busca
// ============================================================
app.get('/api/buscar', async (req, res) => {
    const nome = req.query.nome;
    if (!nome) return res.status(400).json([]);
    try {
        const r = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(nome)}&language=pt-BR`);
        res.json((r.data.results || []).map(mapFilme));
    } catch (e) { res.status(500).json([]); }
});

// ============================================================
// ROTA 3 — Detecta players
// Busca IMDB ID do filme em paralelo com os testes de fonte
// ============================================================
app.get('/api/player/:id', async (req, res) => {
    const filmeId = req.params.id;
    if (!/^\d{1,10}$/.test(filmeId)) return res.status(400).json({ error: 'Identificador de filme inválido' });

    // Busca IMDB ID em paralelo (necessário para fontes BR)
    const imdbId = await getImdbId(filmeId);
    console.log(`\n[player] ID ${filmeId} → IMDB: ${imdbId || 'não encontrado'}`);

    const fontes = getFontes(filmeId, imdbId);
    console.log(`[player] Testando ${fontes.length} fontes...`);

    const resultados = await Promise.allSettled(
        fontes.map((fonte, i) => ({ fonte, i })).filter(({ fonte }) => fonte.dub || fonte.optional).map(async ({ fonte, i }) => {
            const t0    = Date.now();
            const teste = fonte.modo === 'proxy'
                ? await testarProxy(fonte)
                : await testarDireto(fonte);
            console.log(`  [${i}] ${fonte.nome.padEnd(22)} ${teste.ok?'✅':'❌'} ${Date.now()-t0}ms  ${teste.motivo||''}`);
            return { fonte, teste, i };
        })
    );

    const players = resultados
        .filter(r => r.status === 'fulfilled')
        .map(({ value: { fonte, teste, i } }) => ({
            nome:      fonte.nome,
            dub:       fonte.dub,
            optional: Boolean(fonte.optional),
            funcionou: teste.ok,
            qualidade: fonte.qualidade || null,
            manual:    Boolean(teste.manual)||Boolean(fonte.comAnuncios),
            status:    teste.ok ? 'pagina-acessivel' : teste.manual ? 'verificacao-no-navegador' : 'indisponivel',
            motivo:    teste.motivo || null,
            url:       fonte.url,
            urlCompatibilidade: `/assistir/${filmeId}/${i}`,
        }))
        .sort((a, b) => {
            const s = p => (p.funcionou ? 10 : 0) + (p.nome.startsWith('CdnEmbed') ? 1 : 0);
            return s(b) - s(a);
        });

    try { const additional=await libraryCatalog.sources(filmeId); players.push(...additional.filter(p=>p.index>=8)); } catch {}
    const melhor = players.find(p => p.dub && p.funcionou) || null;
    console.log(`[player] Melhor: ${melhor?.nome || 'nenhuma'}\n`);
    res.json({ players, melhor });
});

// ============================================================
// Modo opcional em aba separada. Mantém o contexto de incorporação exigido
// pelo fornecedor, permitindo seus formulários, pop-ups e verificações.
// A abertura é sempre uma escolha do usuário, nunca um fallback automático.
app.get('/assistir/:filmeId/:fonteIndex', async (req, res) => {
    const { filmeId, fonteIndex } = req.params;
    if (!/^\d{1,10}$/.test(filmeId) || !/^[0-7]$/.test(fonteIndex)) return res.status(400).send('Fonte inválida');
    return res.redirect(`/assistir.html?id=${filmeId}&source=${fonteIndex}`);
});

// ROTA 4 — Proxy reverso (fontes modo "proxy")
// ============================================================
app.get('/proxy/player/:filmeId/:fonteIndex', async (req, res) => {
    const { filmeId, fonteIndex } = req.params;
    const imdbId = await getImdbId(filmeId);
    const fontes = getFontes(filmeId, imdbId);
    const fonte  = fontes[parseInt(fonteIndex)];

    if (!fonte) return res.status(400).send('Fonte inválida');
    console.log(`[proxy] → ${fonte.nome}`);

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-presentation');

    try {
        const r = await axios.get(fonte.url, {
            headers: { ...H, 'Referer': fonte.referer, 'Origin': new URL(fonte.url).origin },
            responseType: 'arraybuffer',
            timeout:      fonte.timeout + 5000,
            maxRedirects: 10,
        });

        const html = Buffer.from(r.data).toString('utf-8');

        for (const b of BLOQUEIOS) {
            if (html.includes(b)) {
                return res.send(htmlErro(fonte.nome, 'Proteção detectada — tente outra fonte'));
            }
        }

        res.send(limparHtml(html, new URL(fonte.url).origin));
    } catch (err) {
        res.status(502).send(htmlErro(fonte.nome, err.code || err.message));
    }
});

// ============================================================
// ROTA 5 — Debug
// ============================================================
app.get('/debug/player/:filmeId/:fonteIndex', async (req, res) => {
    const { filmeId, fonteIndex } = req.params;
    const imdbId = await getImdbId(filmeId);
    const fontes = getFontes(filmeId, imdbId);
    const fonte  = fontes[parseInt(fonteIndex)];
    if (!fonte) return res.status(400).send('Fonte inválida');

    try {
        const r = await axios.get(fonte.url, {
            headers: { ...H, 'Referer': fonte.referer || fonte.url },
            responseType: 'text', timeout: 15000, maxRedirects: 10,
        });
        const html = r.data || '';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send([
            `=== DEBUG [${fonteIndex}] ${fonte.nome} ===`,
            `TMDB ID   : ${filmeId}`,
            `IMDB ID   : ${imdbId || 'não encontrado'}`,
            `URL       : ${fonte.url}`,
            `Modo      : ${fonte.modo}`,
            `Status    : ${r.status}`,
            `Ct-Type   : ${r.headers['content-type']}`,
            `Tamanho   : ${html.length} chars`,
            ``,
            `=== IFRAMEs ===`,
            ...[...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => '  ' + m[1]),
            ``,
            `=== BLOQUEIOS ===`,
            ...BLOQUEIOS.filter(b => html.includes(b)).map(b => '  ⚠ ' + b),
            ``,
            `=== PRIMEIROS 3000 CHARS ===`,
            html.substring(0, 3000),
        ].join('\n'));
    } catch (err) {
        res.status(502).send(`Erro: ${err.message}`);
    }
});

// ============================================================
// Helpers HTML
// ============================================================
function htmlErro(nome, motivo) {
    return `<!DOCTYPE html><html><body style="background:#111;color:#fff;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:14px;text-align:center;padding:24px">
<div style="font-size:2.5rem">⚠️</div>
<h2 style="color:#E50914">Fonte indisponível</h2>
<p style="color:#888">${nome}</p>
<p style="color:#555;font-size:.8rem">${motivo || ''}</p>
<p style="color:#444;font-size:.75rem">Tente outra fonte na barra acima.</p>
</body></html>`;
}

// ============================================================
// Se a porta preferida estiver ocupada (uma instância antiga, por exemplo), o
// aplicativo não fica preso: assume a próxima porta livre e abre o navegador
// nela, para o usuário nunca ver uma versão velha do player.
function portaEstaUsada(porta) {
    return new Promise(resolve => {
        const teste = require('net').createServer();
        teste.once('error', () => resolve(true));
        teste.once('listening', () => teste.close(() => resolve(false)));
        teste.listen(porta, '0.0.0.0');
    });
}
async function portaLivre(preferida) {
    for (let passo = 0; passo < 12; passo++) {
        const candidata = Number(preferida) + passo;
        if (!(await portaEstaUsada(candidata))) return candidata;
    }
    return Number(preferida);
}

(async () => {
const PORTA_ESCOLHIDA = await portaLivre(PORT);
process.env.CONECTA_PORTA = String(PORTA_ESCOLHIDA);
if (Number(PORTA_ESCOLHIDA) !== Number(PORT)) console.log(`A porta ${PORT} já estava em uso (outra instância aberta). Usando a porta ${PORTA_ESCOLHIDA}.`);
app.listen(PORTA_ESCOLHIDA, '0.0.0.0', () => {
    const privado = ip => /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
    const rede = Object.values(os.networkInterfaces()).flat()
        .filter(item => item && item.family === 'IPv4' && !item.internal)
        .map(item => item.address);
    const alvo = rede.find(privado) || rede[0];
    console.log('\n  Conecta TV está no ar.');
    console.log(`  Neste computador  : http://localhost:${PORTA_ESCOLHIDA}`);
    if (alvo) console.log(`  No iPhone/celular : http://${alvo}:${PORTA_ESCOLHIDA}   (mesma rede Wi-Fi)`);
    console.log('  Regra do aplicativo: dublado, sem anúncio e em HD.\n');
});
})();
