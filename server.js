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
// Só confia no X-Forwarded-For vindo de intermediários da rede interna (Caddy,
// túneis, Docker, Tailscale). Com "true", qualquer cliente trocava o próprio IP.
app.set('trust proxy', 'loopback, linklocal, uniquelocal, 100.64.0.0/10');
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
// Avisos públicos de manutenção, sem dados pessoais e sem rota HTTP de escrita.
app.get('/api/notificacoes', (req,res)=>{res.setHeader('Cache-Control','no-store');res.json({avisos:require('./avisos-servidor-store.cjs').ler(path.join(DADOS_DIR,'avisos-servidor.json'))});});
app.use((req, res, next) => portao.middleware(req, res, next));
// IDs de catálogo e, opcionalmente, a origem curta restrita do ClickHost.
// A origem não permite ao cliente escolher outro host, porta ou caminho.
app.post('/api/qualidade/clickhost',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{const result=await require('./clickhost-delivery.cjs').resolve(req.body);if(result)return res.json(result);}catch{ /* Falha mantém as outras fontes disponíveis. */ }
    res.status(502).json({error:'Entrega segura indisponível'});
});
// Só resumos de identidade e idioma: nunca entrega URLs, chaves ou transcrições.
app.post('/api/qualidade/idiomas', (req,res)=>{
    const titulo=String(req.body?.titulo || '');
    const provas=require('./provas-idioma');
    if(!provas.tituloValido(titulo))return res.status(400).json({error:'Título inválido'});
    require('./central-reporter').solicitarIdioma(titulo);
    res.setHeader('Cache-Control','no-store');
    res.json({provas:provas.publicas(require('./fontes-motor').lerProvasDeIdioma(),titulo)});
});

const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';
const RAIZ = __dirname;

// ============================================================
// ROTAS — cada assunto mora no seu arquivo em rotas/. A ordem de registro
// importa: "tv" precisa vir antes de "catalogo" (o catálogo responde a
// /api/tv/... por expressão regular e engoliria as rotas da TV ao vivo).
// Cada módulo devolve o que declarou; o seguinte pode usar pelo ctx.
// ============================================================
const ctx = { axios, fs, path, os, RAIZ, LOCAL_CONFIG, GROQ_KEY, GEMINI_KEY, PAGE_CANDIDATES,
    DADOS_DIR, ARQ_ACESSOS, ARQ_LEGENDAS, seguranca, portao, TMDB_KEY };
for (const registrar of [
    require('./rotas/aparelhos'),
    require('./rotas/jarvis'),
    require('./rotas/paginas'),
    require('./rotas/acessos'),
    require('./rotas/legendas'),
    require('./rotas/playback'),
    require('./rotas/downloads'),
    require('./rotas/tv'),
    require('./rotas/catalogo'),
    require('./rotas/legado-players'),
]) Object.assign(ctx, registrar(app, ctx));
const central = ctx.central;

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
// Liga o vigia das fontes: ele roda junto com o aplicativo e testa filmes em
// rodízio (24h) para manter a escolha de fonte sempre saudável.
try {
    require('./vigia-fontes').iniciar({
        tmdbKey: TMDB_KEY,
        registrar: mensagem => console.log('[vigia] ' + mensagem),
        reportar: evento => central.reportar(evento),
    });
} catch (erro) { console.log('[vigia] não ligou: ' + erro.message); }

// Fichas de fonte do caçador da central: busca a lista publicada no início e a
// cada 6 horas — é o que faz uma fonte nova aprovada aparecer no aplicativo sem
// atualizar nada. Sem internet, segue com a cópia que veio dentro do programa.
try {
    const fichas = require('./perfis-locais');
    const buscarFichas = () => fichas.atualizar()
        .then(r => { if (r && r.mudou) console.log(`[fichas] ${r.perfis} fonte(s) aprovadas pelo caçador`); })
        .catch(() => {});
    buscarFichas();
    // Fonte nova aprovada no PC chega aos servidores em até 20 min.
    setInterval(buscarFichas, 20 * 60 * 1000);
} catch (erro) { console.log('[fichas] não ligou: ' + erro.message); }

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
