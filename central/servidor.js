'use strict';
// Central do Conecta TV — aplicativo separado, só de status.
//
// Ele não reproduz nada: recebe o que os aplicativos contam (quem entrou, o que
// está assistindo, por qual fonte, se deu certo) e mostra tudo em um painel.
//
// Como rodar:   node central/servidor.js            (porta 4100)
// Painel:       http://localhost:4100  → pede a chave (CENTRAL_KEY)

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// require com caminho fixo: é assim que o empacotador (.exe) enxerga o arquivo.
const seguranca = require('../seguranca.js');
const identidade = require('./identidade.js');
const { criarAgente } = require('./agente.js');
const { criarCacador } = require('./cacador.js');
const { criarRegistro } = require('./titulos.js');
const { criarPlacar } = require('./placar.js');
const { criarRevisor } = require('./revisor.js');
const { criarClienteApp } = require('./app-client.js');

const app = express();
const PORTA = Number(process.env.PORT || process.env.CENTRAL_PORT || 4100);
// Onde os dados ficam. Em hospedagem, aponte CENTRAL_DADOS para um disco
// permanente (volume) — senão o histórico se perde a cada atualização. No
// programa instalado (.exe), a pasta fica ao lado do executável, porque dentro
// do pacote não dá para gravar.
const DADOS = String(process.env.CENTRAL_DADOS || '').trim()
    || (process.pkg ? path.join(path.dirname(process.execPath), 'dados') : path.join(__dirname, 'dados'));
const ARQ_DISPOSITIVOS = path.join(DADOS, 'dispositivos.json');
const ARQ_EVENTOS = path.join(DADOS, 'eventos.ndjson');
const ACESSO = (() => {
    const arquivos = [path.join(__dirname, 'config.local.json'), path.join(process.cwd(), 'central', 'config.local.json'), path.join(process.cwd(), 'config.local.json')];
    for (const arquivo of arquivos) { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { /* opcional */ } }
    return {};
})();

// Chave do painel: sem ela o painel não abre. No computador, a chave é criada
// uma vez e guardada em dados/chave.txt — assim ela não muda a cada abertura.
const ARQ_CHAVE = path.join(DADOS, 'chave.txt');
let CHAVE = String(process.env.CENTRAL_KEY || ACESSO.centralKey || '').trim();
let chaveGerada = false;
if (CHAVE.length < 8) {
    try { CHAVE = fs.readFileSync(ARQ_CHAVE, 'utf8').trim(); } catch { CHAVE = ''; }
}
if (CHAVE.length < 8) {
    CHAVE = crypto.randomBytes(9).toString('base64url');
    chaveGerada = true;
    try { fs.mkdirSync(DADOS, { recursive: true }); fs.writeFileSync(ARQ_CHAVE, CHAVE + '\n'); } catch { /* sem permissão: fica só na memória */ }
}
// Token opcional que os aplicativos usam para reportar (se vazio, qualquer um
// da rede pode reportar — só use assim em rede fechada).
const TOKEN_APPS = String(process.env.CENTRAL_TOKEN || ACESSO.centralToken || '').trim();
const COOKIE_CHAVE = 'central_chave';

// O agente investiga falhas chamando o próprio aplicativo. O endereço e o
// código podem vir do ambiente ou de um arquivo app.local.json na pasta.
const CONFIG_APP = (() => {
    const arquivos = [path.join(__dirname, 'app.local.json'), path.join(process.cwd(), 'central', 'app.local.json')];
    for (const arquivo of arquivos) { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { /* opcional */ } }
    return {};
})();
const APP_URL = String(process.env.APP_URL || CONFIG_APP.url || 'http://127.0.0.1:3000').replace(/\/$/, '');
const APP_CODIGO = String(process.env.APP_ACESSO_CODIGO || CONFIG_APP.codigo || '').trim();

fs.mkdirSync(DADOS, { recursive: true });

// Agente de investigação (descobre por qual fonte o título que falhou abre) e
// caçador de fornecedores (dá nota de 0 a 10 para cada fonte).
const agente = criarAgente({ pastaDados: DADOS, appUrl: APP_URL, codigoApp: APP_CODIGO });
// Histórico de qualidade por título (alimentado pelos eventos do aplicativo).
const titulos = criarRegistro({ pastaDados: DADOS });
// Placar real: o que acontece com quem usa o aplicativo (aberturas, confirmações
// e falhas por fonte). Entra na nota do caçador e na ordem das fontes no app.
const placar = criarPlacar({ arquivoEventos: ARQ_EVENTOS });
placar.atualizar();
const cacador = criarCacador({
    pastaDados: DADOS,
    titulos,
    placar,
    registrar: mensagem => console.log('[cacador] ' + mensagem),
});
agente.iniciar();
// Revisor automático: pega os títulos com problema e manda o agente testar as
// fontes de novo, guardando a solução encontrada.
const revisor = criarRevisor({ titulos, agente });
revisor.iniciar();
// Caçada automática de fornecedores: a cada 6 horas o caçador procura fontes
// novas, alternando as categorias. O varredor (addons do Stremio, GitHub e o
// código dos agregadores) alimenta a lista de candidatas, e cada uma é MEDIDA
// (reprodução + idioma + anúncio) antes de entrar no ranking.
const CATEGORIAS_CACADAS = ['filme', 'serie', 'dorama', 'anime', 'tv-online'];
let voltaDaCacada = 0;
function cacadaAutomatica() {
    try {
        if (cacador.rodando()) return;
        const categoria = CATEGORIAS_CACADAS[voltaDaCacada % CATEGORIAS_CACADAS.length];
        voltaDaCacada += 1;
        console.log('[central] caçada automática: ' + categoria);
        cacador.cacar(categoria).catch(() => {});
    } catch { /* nunca impede a central de subir */ }
}
setTimeout(cacadaAutomatica, 8 * 60 * 1000);
setInterval(cacadaAutomatica, 6 * 60 * 60 * 1000);
// Ponte com o aplicativo: lista e bloqueia aparelhos autorizados.
const clienteApp = criarClienteApp({ appUrl: APP_URL, codigo: APP_CODIGO });

// ---------------------------------------------------------------- armazenamento
function lerJson(arquivo, padrao) {
    try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return padrao; }
}
function gravarJson(arquivo, dados) {
    try { fs.writeFileSync(arquivo, JSON.stringify(dados, null, 1)); } catch (erro) { console.warn('[central] não consegui gravar ' + arquivo + ': ' + erro.message); }
}
function anotarEvento(evento) {
    try { fs.appendFileSync(ARQ_EVENTOS, JSON.stringify(evento) + '\n'); } catch { /* disco cheio ou sem permissão */ }
}

// O placar é lido do arquivo de relatos: a conta é refeita no máximo a cada
// minuto (para não reler o arquivo a cada evento) e fica guardada junto das
// fichas, que o aplicativo lê na mesma máquina.
let placarSujo = false;
let ultimoPlacar = 0;
let ultimaPublicacao = 0;
function marcarPlacarParaAtualizar() { placarSujo = true; }
function atualizarPlacarSePreciso(forcar = false) {
    if (!forcar && !placarSujo && Date.now() - ultimoPlacar < 60000) return placar.resumo();
    placarSujo = false;
    ultimoPlacar = Date.now();
    const tabela = placar.atualizar();
    try {
        const fichas = require('./perfis');
        fichas.gravarPlacar(DADOS, tabela);
        // Publica no GitHub de vez em quando (o celular não vê o disco deste
        // computador): fichas novas publicam na hora, o placar a cada 2 horas.
        if (Date.now() - ultimaPublicacao > 2 * 60 * 60 * 1000) {
            ultimaPublicacao = Date.now();
            fichas.publicar(DADOS, tokenDoGithub()).catch(() => {});
        }
    } catch { /* o placar é opcional */ }
    return tabela;
}
function tokenDoGithub() {
    try { return fs.readFileSync(path.join(require('os').homedir(), '.streamtv', 'github-token.txt'), 'utf8').trim(); } catch { return ''; }
}
function lerEventos(limite = 4000) {
    try {
        const linhas = fs.readFileSync(ARQ_EVENTOS, 'utf8').trim().split('\n').filter(Boolean);
        return linhas.slice(-limite).map(linha => { try { return JSON.parse(linha); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
}

// ---------------------------------------------------------------- utilidades
function ipDoPedido(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}
function texto(valor, limite) { return String(valor ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limite); }
function minutosDesde(iso) { const t = new Date(iso || 0).getTime(); return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null; }
function curto(iso) { return String(iso || '').slice(0, 16).replace('T', ' '); }
function chaveDoPedido(req) {
    const cabecalho = String(req.headers['x-chave'] || '').trim();
    if (cabecalho) return cabecalho;
    const bruto = String(req.headers.cookie || '');
    const achado = bruto.split(';').map(p => p.trim()).find(p => p.startsWith(COOKIE_CHAVE + '='));
    if (achado) return decodeURIComponent(achado.slice(COOKIE_CHAVE.length + 1));
    return String(req.query.chave || '');
}

// ---------------------------------------------------------------- meio de campo
app.set('trust proxy', true);
app.use(seguranca.cabecalhos({ origensPermitidas: [] }));
app.use(express.json({ limit: '256kb' }));
app.use(seguranca.criarLimitador({ janelaMs: 60000, maximo: 600, maximoMidia: 600 }));

// ---------------------------------------------------------------- relatos dos apps
app.post('/api/acesso', (req, res) => {
    if (TOKEN_APPS && String(req.headers['x-central'] || '') !== TOKEN_APPS) return res.status(401).json({ error: 'token da central inválido' });
    const corpo = req.body || {};
    const nome = texto(corpo.nome, 60);
    if (!nome) return res.status(400).json({ error: 'informe o nome' });
    const dispositivo = texto(corpo.dispositivo, 40) || ('ip-' + ipDoPedido(req));
    const lista = lerJson(ARQ_DISPOSITIVOS, {});
    const anterior = lista[dispositivo] || {};
    const agora = new Date().toISOString();
    lista[dispositivo] = {
        dispositivo,
        nome,
        aparelho: texto(corpo.aparelho, 40) || anterior.aparelho || 'Aparelho',
        app: texto(corpo.app, 20) || anterior.app || 'conecta-tv',
        versao: texto(corpo.versao, 20) || anterior.versao || '',
        assistindo: corpo.assistindo ? texto(corpo.assistindo, 90) : (anterior.assistindo || null),
        ip: ipDoPedido(req),
        primeiroEm: anterior.primeiroEm || agora,
        ultimoEm: agora,
        vezes: Number(anterior.vezes || 0) + 1
    };
    gravarJson(ARQ_DISPOSITIVOS, lista);
    const pessoas = new Set(Object.values(lista).map(item => item.nome.toLowerCase())).size;
    res.json({ ok: true, pessoas, aparelhos: Object.keys(lista).length });
});

app.post('/api/evento', (req, res) => {
    if (TOKEN_APPS && String(req.headers['x-central'] || '') !== TOKEN_APPS) return res.status(401).json({ error: 'token da central inválido' });
    const corpo = req.body || {};
    const evento = {
        em: new Date().toISOString(),
        tipo: texto(corpo.tipo, 24) || 'sessao',
        dispositivo: texto(corpo.dispositivo, 40),
        nome: texto(corpo.nome, 60) || 'Anônimo',
        aparelho: texto(corpo.aparelho, 40),
        app: texto(corpo.app, 20) || 'conecta-tv',
        versao: texto(corpo.versao, 20),
        // O id do título é o que permite o agente investigar o caso certo.
        id: texto(corpo.id, 10),
        episodio: texto(corpo.episodio, 20),
        temporada: texto(corpo.temporada, 3),
        numero: texto(corpo.numero, 4),
        titulo: texto(corpo.titulo, 120),
        fonte: texto(corpo.fonte, 40),
        // Identificador da fonte (ex.: watchplay, pipoca, vixsrc, ficha do
        // caçador): é o que liga o relato do aparelho ao placar das fontes.
        fonteId: texto(corpo.fonteId, 40),
        audio: texto(corpo.audio, 20),
        resolucao: texto(corpo.resolucao, 20),
        taxa: texto(corpo.taxa, 20),
        ms: Number(corpo.ms) || 0,
        // Um relato do tipo "falha" nunca pode aparecer como "abriu", mesmo que
        // o aplicativo antigo não mande o campo ok.
        ok: texto(corpo.tipo, 24) === 'falha' ? false : corpo.ok !== false,
        motivo: texto(corpo.motivo, 120)
    };
    // A avaliação em tempo real (disputa das fontes) vem como lista — guarda
    // o que dá para o painel mostrar por título.
    if (Array.isArray(corpo.avaliacao)) {
        evento.avaliacao = corpo.avaliacao.slice(0, 6).map(item => ({
            fonte: texto(item && item.fonte, 30),
            nota: Number(item && item.nota) || 0,
            idioma: texto(item && item.idioma, 60),
            qualidade: texto(item && item.qualidade, 20),
            taxa: texto(item && item.taxa, 20),
        }));
    }
    anotarEvento(evento);
    // Histórico por título (qualidade medida, escolha e falhas).
    try { titulos.registrar(evento); } catch { /* o evento já foi anotado */ }
    // Placar das fontes: só o relato que fala de fonte (abertura, confirmação ou
    // falha) mexe no placar — e, com ele, na ordem das fontes no aplicativo.
    if (['play', 'confirmacao', 'falha'].includes(evento.tipo)) marcarPlacarParaAtualizar();
    // Player que não abriu entra na fila do agente, que vai testar as fontes.
    if (evento.ok === false) agente.registrarFalha(evento);
    if (evento.dispositivo) {
        const lista = lerJson(ARQ_DISPOSITIVOS, {});
        const anterior = lista[evento.dispositivo];
        if (anterior) {
            if (evento.titulo) anterior.assistindo = evento.titulo;
            anterior.ultimoEm = evento.em;
            gravarJson(ARQ_DISPOSITIVOS, lista);
        }
    }
    res.json({ ok: true });
});

// ---------------------------------------------------------------- painel
function exigirChave(req, res, next) {
    const enviada = chaveDoPedido(req);
    // Comparação por resumo (sha256): sempre do mesmo tamanho, sem depender de
    // acento, espaço ou tamanho da chave, e sem vazar tempo de resposta.
    const resumo = valor => crypto.createHash('sha256').update(String(valor), 'utf8').digest();
    const aceita = enviada.length >= 8 && crypto.timingSafeEqual(resumo(enviada), resumo(CHAVE));
    if (aceita) return next();
    if (String(req.headers.accept || '').includes('text/html')) return res.status(401).type('html').send(paginaDeChave(enviada ? 'Chave incorreta.' : ''));
    return res.status(401).json({ error: 'informe a chave da central' });
}

app.post('/api/entrar', (req, res) => {
    const enviada = String(req.body?.chave || '').trim();
    if (enviada.length < 8 || enviada !== CHAVE) return res.status(401).json({ error: 'Chave incorreta.' });
    const seguro = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.setHeader('Set-Cookie', `${COOKIE_CHAVE}=${encodeURIComponent(enviada)}; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`);
    res.json({ ok: true });
});

app.get('/api/status', exigirChave, async (req, res) => res.json(await gerarStatus()));
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'central-conecta-tv' }));

// ------------------------------------------------------------------ ações
// Investiga um título na hora (o mesmo trabalho que o agente faz sozinho).
app.post('/api/investigar', exigirChave, async (req, res) => {
    const corpo = req.body || {};
    const id = String(corpo.id || '').trim();
    if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ error: 'informe o id do TMDB' });
    const alvo = {
        tipo: corpo.tipo === 'tv' ? 'tv' : 'movie',
        id,
        titulo: texto(corpo.titulo, 120),
        temporada: texto(corpo.temporada, 3) || '1',
        episodio: texto(corpo.episodio, 4) || '1'
    };
    const caso = await agente.investigar(alvo, 'investigação pedida no painel').catch(() => null);
    res.json({ ok: Boolean(caso), caso });
});

// Roda o caçador de fornecedores em segundo plano (demora alguns minutos).
app.post('/api/cacar', exigirChave, (req, res) => {
    if (cacador.rodando()) return res.json({ ok: true, rodando: true });
    const categoria = texto(req.body?.categoria, 20) || 'todas';
    // Caçada profunda: varre muito mais candidatas, procura o vídeo dentro das
    // páginas e tenta virar ficha — demora bem mais e gasta mais rede.
    const profundo = req.body?.profundo === true || req.body?.profundo === 'sim';
    cacador.cacar(categoria, { profundo }).catch(() => {});
    res.json({
        ok: true, iniciado: true, categoria, profundo,
        aviso: profundo
            ? 'caçada profunda: leva bastante tempo (varre páginas e valida fichas); o painel mostra o andamento'
            : 'a busca leva alguns minutos; o painel se atualiza sozinho',
    });
});

app.get('/api/fontes', exigirChave, (req, res) => res.json(cacador.ultimo() || { ranking: [], candidatas: [], atualizadoEm: null }));

// Andamento da caçada (o que está sendo medido agora).
app.get('/api/cacar/estado', exigirChave, (req, res) => res.json({
    rodando: cacador.rodando(),
    categoria: cacador.categoriaAtual(),
    andamento: cacador.progresso ? cacador.progresso() : null,
}));

// Placar real das fontes (relatos dos aparelhos).
app.get('/api/placar', exigirChave, (req, res) => {
    const tabela = atualizarPlacarSePreciso(Boolean(req.query.forcar));
    res.json({ atualizadoEm: new Date().toISOString(), fontes: tabela, problematicas: placar.problematicas() });
});

// Fichas de fonte aprovadas pelo caçador (e as listas de canais novas).
app.get('/api/perfis', exigirChave, (req, res) => {
    const fichas = require('./perfis');
    const dados = fichas.ler(DADOS);
    res.json({
        atualizadoEm: dados.atualizadoEm,
        perfis: dados.perfis.map(p => ({ ...p, provas: (p.provas || []).slice(0, 3) })),
        listasTv: dados.listasTv,
    });
});

// Qualidade por título (histórico medido pelo aplicativo).
app.get('/api/titulos', exigirChave, (req, res) => {
    const limite = Math.max(1, Math.min(200, Number(req.query.limite) || 60));
    res.json({ total: titulos.total(), titulos: titulos.listar(limite), problemas: titulos.comProblema(20) });
});

// Aparelhos autorizados no aplicativo (a central pergunta para o próprio app).
app.get('/api/aparelhos', exigirChave, async (req, res) => {
    const dados = await clienteApp.listarAparelhos();
    res.json(dados);
});

// Bloqueia um aparelho: ele é removido do aplicativo e não consegue entrar de
// novo nem com o código.
app.post('/api/aparelhos/bloquear', exigirChave, async (req, res) => {
    const token = String((req.body && req.body.token) || '');
    if (!token) return res.status(400).json({ error: 'informe o aparelho' });
    const resultado = await clienteApp.bloquear(token);
    res.status(resultado.ok ? 200 : 502).json(resultado);
});

// Revisão automática sob demanda: testa de novo os títulos com problema e
// guarda a solução encontrada (o agente usa as rotas do próprio aplicativo).
app.post('/api/revisar-titulos', exigirChave, (req, res) => {
    if (revisor.rodando()) return res.json({ ok: true, rodando: true });
    const limite = Math.max(1, Math.min(8, Number(req.body && req.body.limite) || 3));
    revisor.revisarAgora(limite).catch(() => {});
    res.json({ ok: true, iniciado: true, limite, aviso: 'a revisão testa as fontes no aplicativo; acompanhe pelo painel' });
});

// Conferência sob demanda de um endereço de vídeo: reproduz no navegador e
// ouve o áudio (idioma confirmado). Usado nos testes e pelo painel.
app.get('/api/conferir-midia', exigirChave, async (req, res) => {
    const endereco = String(req.query.url || '');
    if (!/^https:\/\//i.test(endereco)) return res.status(400).json({ erro: 'endereço inválido' });
    try {
        const robo = require('./verificar-navegador');
        const midia = require('./verificar-midia');
        const tipo = /\.m3u8(\?|$)/i.test(endereco) ? 'hls' : 'file';
        const reproducao = await robo.tocarNoNavegador(endereco, { tipo, segundos: 20 });
        const idioma = await midia.verificarIdioma({
            url: endereco, tipo: 'movie', fonteId: 'conferencia',
            amostra: { id: 'sob-demanda-' + Date.now().toString().slice(-6) },
            chaveIa: (() => { try { return require('./cacador').chaveDaIA(); } catch { return ''; } })(),
        });
        res.json({ ok: true, reproducao, idioma, roboDisponivel: Boolean(robo.acharNavegador()) });
    } catch (erro) {
        res.status(502).json({ erro: String(erro.message).slice(0, 120) });
    }
});

// Entrada pela chave no endereço: o atalho do computador abre o painel já
// dentro, sem digitar nada (a chave vira cookie e sai da barra de endereços).
app.get('/entrar', (req, res) => {
    const enviada = String(req.query.chave || '').trim();
    res.setHeader('Cache-Control', 'no-store');
    if (enviada.length < 8 || enviada !== CHAVE) return res.status(401).type('html').send(paginaDeChave('Chave incorreta.'));
    res.setHeader('Set-Cookie', `${COOKIE_CHAVE}=${encodeURIComponent(enviada)}; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax`);
    res.redirect('/');
});

app.get('/', exigirChave, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(fs.readFileSync(path.join(__dirname, 'painel.html'), 'utf8'));
});

// ---------------------------------------------------------------- números do painel
// Identidade do aparelho (tipo, rede, localização) é guardada por 10 minutos:
// consultar o reverso do IP toda hora deixaria o painel lento.
const cacheIdentidade = new Map();
async function identidadeDe(dispositivo, eventos) {
    const chave = `${dispositivo.dispositivo}|${dispositivo.ip}|${dispositivo.app}|${dispositivo.aparelho}`;
    const guardado = cacheIdentidade.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.dados;
    const dados = await identidade.descrever(dispositivo, eventos).catch(() => null);
    if (dados) cacheIdentidade.set(chave, { dados, expira: Date.now() + 10 * 60 * 1000 });
    return dados;
}

async function gerarStatus() {
    const dispositivos = Object.values(lerJson(ARQ_DISPOSITIVOS, {}));
    const eventos = lerEventos();
    const agora = Date.now();
    const hoje = new Date().toISOString().slice(0, 10);

    const aparelhos = [];
    for (const item of dispositivos) {
        const minutos = minutosDesde(item.ultimoEm);
        const meusEventos = eventos.filter(e => e.dispositivo === item.dispositivo);
        aparelhos.push({
            ...item,
            online: minutos !== null && minutos < 5,
            minutos,
            ultimoCurto: curto(item.ultimoEm),
            primeiroCurto: curto(item.primeiroEm),
            identidade: await identidadeDe(item, meusEventos)
        });
    }
    aparelhos.sort((a, b) => String(b.ultimoEm).localeCompare(String(a.ultimoEm)));

    const eventosDeHoje = eventos.filter(e => String(e.em).slice(0, 10) === hoje);
    const sessoes = eventosDeHoje.filter(e => e.tipo === 'play' || e.tipo === 'sessao');
    const falhas = eventosDeHoje.filter(e => e.ok === false);

    const porFonte = {};
    for (const evento of eventos.filter(e => e.fonte)) {
        const alvo = porFonte[evento.fonte] || (porFonte[evento.fonte] = { fonte: evento.fonte, total: 0, ok: 0, falhas: 0, ultimaFalha: null, ultimoUso: null, resolucoes: new Set() });
        alvo.total++;
        if (evento.ok === false) { alvo.falhas++; if (!alvo.ultimaFalha || evento.em > alvo.ultimaFalha) alvo.ultimaFalha = evento.em; }
        else alvo.ok++;
        if (evento.resolucao) alvo.resolucoes.add(evento.resolucao);
        if (!alvo.ultimoUso || evento.em > alvo.ultimoUso) alvo.ultimoUso = evento.em;
    }
    const fontes = Object.values(porFonte).map(item => ({
        fonte: item.fonte,
        total: item.total,
        ok: item.ok,
        falhas: item.falhas,
        taxa: item.total ? Math.round((item.ok / item.total) * 100) : 0,
        resolucoes: [...item.resolucoes],
        ultimaFalha: item.ultimaFalha,
        ultimoUso: item.ultimoUso
    })).sort((a, b) => b.total - a.total);

    const versoes = {};
    for (const item of aparelhos) { const v = item.versao || 'sem versão'; versoes[v] = (versoes[v] || 0) + 1; }

    const horas = [];
    for (let i = 23; i >= 0; i--) {
        const faixa = new Date(agora - i * 3600000);
        const rotulo = String(faixa.getHours()).padStart(2, '0') + 'h';
        const fatia = String(faixa.toISOString()).slice(0, 13);
        horas.push({ rotulo, quantidade: eventos.filter(e => String(e.em).slice(0, 13) === fatia).length, sessoes: eventos.filter(e => String(e.em).slice(0, 13) === fatia && (e.tipo === 'play' || e.tipo === 'sessao')).length });
    }

    const alertas = [];
    for (const fonte of fontes) if (fonte.total >= 4 && fonte.taxa < 70) alertas.push(`Fonte ${fonte.fonte} caiu para ${fonte.taxa}% de sucesso (${fonte.falhas} falhas em ${fonte.total} usos).`);
    for (const item of aparelhos) if (item.minutos !== null && item.minutos > 7 * 1440) alertas.push(`${item.nome} (${item.aparelho}) está sem dar sinal há ${Math.round(item.minutos / 1440)} dias.`);
    const desatualizados = aparelhos.filter(item => item.versao && item.versao !== '1.0' && item.versao !== '');
    if (desatualizados.length > 1) alertas.push(`${desatualizados.length} aparelhos com versão registrada diferente — vale conferir se estão na última atualização.`);
    if (falhas.length >= 5) alertas.push(`${falhas.length} falhas registradas hoje. Veja a tabela de fontes para saber qual está devendo.`);
    if (!alertas.length) alertas.push('Tudo em ordem: nenhuma fonte com taxa baixa e nenhum aparelho sumido.');

    return {
        atualizadoEm: new Date().toISOString(),
        resumo: {
            pessoas: new Set(aparelhos.map(a => a.nome.toLowerCase())).size,
            aparelhos: aparelhos.length,
            online: aparelhos.filter(a => a.online).length,
            sessoesHoje: sessoes.length,
            falhasHoje: falhas.length,
            fontes: fontes.length
        },
        aparelhos,
        // Quem está autorizado dentro do aplicativo (com opção de bloquear).
        aparelhosApp: await clienteApp.listarAparelhos().catch(() => ({ ok: false, aparelhos: [], erro: 'não consegui falar com o aplicativo' })),
        fontes,
        versoes,
        horas,
        alertas,
        investigacoes: agente.resumo(),
        fontesCacadas: cacador.ultimo(),
        cacadorRodando: cacador.rodando(),
        cacadorCategoria: cacador.categoriaAtual(),
        cacadorAndamento: cacador.progresso ? cacador.progresso() : null,
        cacadorFila: cacador.fila ? cacador.fila() : null,
        placar: atualizarPlacarSePreciso(),
        fichas: (cacador.fichas ? cacador.fichas() : []).map(f => ({
            id: f.id, nome: f.nome, nota: f.nota, ativo: f.ativo !== false,
            tipos: f.tipos, qualidade: f.qualidade, dublado: f.dublado,
            origem: f.origem, evidencia: (f.evidencia || '').slice(0, 120),
            provas: (f.provas || []).filter(p => p.ok).length,
        })),
        // Qualidade por título: o que o avaliador escolheu e o que o player
        // mediu de verdade (altura, taxa, áudio) — histórico curto por título.
        titulos: { total: titulos.total(), lista: titulos.resumo(12) },
        titulosComProblema: titulos.comProblema(8),
        revisao: revisor.resumo(),
        eventos: eventos.slice(-40).reverse().map(e => ({ ...e, emCurto: curto(e.em) }))
    };
}

function paginaDeChave(erro) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central Conecta TV</title><style>
body{margin:0;background:#0b0e15;color:#e8ecf3;font:15px system-ui;display:grid;place-items:center;min-height:100vh}
form{background:#141924;border:1px solid #ffffff14;border-radius:18px;padding:28px;width:min(340px,90vw)}
h1{margin:0 0 6px;font-size:20px}p{color:#8d97a8;font-size:13px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;background:#1c2230;border:1px solid #2c3444;color:#fff;border-radius:10px;padding:12px}
button{margin-top:16px;width:100%;background:#e50914;border:0;color:#fff;border-radius:10px;padding:12px;font-weight:600}
.erro{color:#ff8f8f;font-size:13px;margin-top:10px}
</style></head><body><form id="f"><h1>Central Conecta TV</h1><p>Painel restrito. Informe a chave da central.</p>
<input id="chave" type="password" placeholder="Chave"><button>Entrar</button><p class="erro">${erro}</p></form>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const chave=document.getElementById('chave').value.trim();
const r=await fetch('/api/entrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave})}).catch(()=>({ok:false}));
if(r.ok){location.href='/';return;}document.querySelector('.erro').textContent='Chave incorreta.';};</script></body></html>`;
}

// ---------------------------------------------------------------- escuta
(async () => {
    const livre = async porta => new Promise(resolve => { const s = require('net').createServer(); s.once('error', () => resolve(false)); s.once('listening', () => s.close(() => resolve(true))); s.listen(porta, '0.0.0.0'); });
    let porta = PORTA;
    for (let i = 0; i < 12; i++) { if (await livre(porta + i)) { porta = PORTA + i; break; } }
    // Escuta em IPv4 e IPv6: assim tanto "localhost" quanto "127.0.0.1" e o IP
    // da rede da casa funcionam para abrir o painel e para receber os relatos.
    app.listen(porta, () => {
        // O atalho do computador usa estas informações para abrir o painel.
        process.env.CENTRAL_PORTA = String(porta);
        process.env.CENTRAL_CHAVE = CHAVE;
        console.log('\n  Central do Conecta TV está no ar.');
        console.log(`  Painel : http://localhost:${porta}`);
        console.log(`  Chave do painel: ${CHAVE}`);
        if (chaveGerada) console.log('  (chave criada agora e guardada em dados/chave.txt)');
        console.log(`  No celular (mesma rede): http://SEU-IP:${porta}`);
        if (!TOKEN_APPS) console.log('  Aviso: sem CENTRAL_TOKEN, qualquer aparelho da rede pode enviar dados.\n');
    });
})();
