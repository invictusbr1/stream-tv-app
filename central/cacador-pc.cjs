'use strict';
// Caçador no PC — roda na máquina forte (e na internet de casa), deixando a
// Oracle leve. Aberto pelo atalho "Cacador-PC.cmd".
//
// A cada rodada:
//   1. pergunta à Central (pelo túnel 127.0.0.1:4100) quais títulos falharam
//      para alguém e vai atrás de cada um em todos os addons dos catálogos;
//   2. de 6 em 6 horas faz a ronda das NOVELAS em exibição (o capítulo de
//      ontem já tem fonte dublada?);
//   3. publica as fichas aprovadas no GitHub — o celular lê de lá direto,
//      sem depender da Oracle nem deste PC ficar ligado depois.
//
// Uso: node central/cacador-pc.cjs            (fica rodando)
//      node central/cacador-pc.cjs --uma-vez  (uma rodada e sai)
//      node central/cacador-pc.cjs --titulo tv:306956:1:137 "Quem Ama Cuida 1x137"
//      node central/cacador-pc.cjs --incluir central/fichas/bestcine.json

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const cacada = require('./cacada-titulo');
const fichas = require('./perfis');
const { sondagemRapida, verificarIdioma } = require('./verificar-midia');
const varredor = require('./varredor');

const RAIZ = path.join(__dirname, '..');
const PASTA = process.env.CACADOR_PC_DADOS || path.join(__dirname, 'dados-pc');
const CENTRAL = String(process.env.CENTRAL_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const INTERVALO = 30 * 60 * 1000;
const RONDA_NOVELAS = 6 * 60 * 60 * 1000;
const REPETIR_TITULO = 6 * 60 * 60 * 1000;
const MAX_POR_RODADA = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function hora() { return new Date().toLocaleTimeString('pt-BR'); }
function log(texto) {
    const linha = `[${hora()}] ${texto}`;
    console.log(linha);
    try { fs.mkdirSync(PASTA, { recursive: true }); fs.appendFileSync(path.join(PASTA, 'cacador-pc.log'), linha + '\n'); } catch { /* segue */ }
}

function chaveDaCentral() {
    if (process.env.CENTRAL_KEY) return process.env.CENTRAL_KEY.trim();
    try { const guardada = fs.readFileSync(path.join(os.homedir(), '.streamtv', 'central-chave.txt'), 'utf8').trim(); if (guardada) return guardada; } catch { /* segue */ }
    try { const m = /\$chavePainel\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(RAIZ, 'Abrir-Central.ps1'), 'utf8')); if (m) return m[1]; } catch { /* sem arquivo */ }
    return '';
}
function tokenDoGithub() {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
    try { return fs.readFileSync(path.join(os.homedir(), '.streamtv', 'github-token.txt'), 'utf8').trim(); } catch { return ''; }
}
function chaveDaIA() {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
    for (const arquivo of [path.join(__dirname, 'config.local.json'), path.join(os.homedir(), 'OneDrive', 'Área de Trabalho', 'api.txt'), path.join(os.homedir(), 'Desktop', 'api.txt')]) {
        try { const achado = fs.readFileSync(arquivo, 'utf8').match(/gsk_[A-Za-z0-9_-]{20,}/); if (achado) return achado[0]; } catch { /* próximo */ }
    }
    return '';
}

async function buscarJson(url, opcoes = {}) {
    const r = await axios.get(url, { timeout: opcoes.tempo || 12000, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opcoes.headers || {}) }, maxContentLength: 8 * 1024 * 1024, validateStatus: s => s < 500 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
}

async function buscarTextoSimples(url) {
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA }, responseType: 'text', transformResponse: x => x, maxContentLength: 4 * 1024 * 1024, validateStatus: s => s < 500 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return String(r.data || '');
}

// Arquivo sem etiqueta de idioma: ouve um trecho (Whisper). Sem chave da IA,
// fica sem prova — e sem prova não vira ficha.
function confirmadorDeIdioma() {
    const chave = chaveDaIA();
    if (!chave) return null;
    return async (pronto, amostra) => {
        const r = await verificarIdioma({ url: pronto.url, referer: pronto.referer || '', tipo: amostra && amostra.temporada ? 'tv' : 'movie', amostra: amostra ? { id: amostra.id, temporada: amostra.temporada, episodio: amostra.episodio } : { id: '0' }, fonteId: 'cacada', chaveIa: chave, central: { pastaDados: PASTA } }).catch(() => null);
        if (!r || !r.idioma) return null;
        return r.idioma === 'pt' ? true : r.idioma === 'outro' ? false : null;
    };
}

async function sessoesDaCentral() {
    const chave = chaveDaCentral();
    const r = await axios.get(CENTRAL + '/api/reproducao?limite=200', { timeout: 15000, headers: chave ? { 'x-chave': chave } : {}, validateStatus: s => s < 500 });
    if (r.status !== 200) throw new Error(r.status === 401 || r.status === 403 ? 'a Central recusou a chave' : 'Central respondeu ' + r.status);
    return Array.isArray(r.data && r.data.sessoes) ? r.data.sessoes : [];
}

function alvoDaSessao(s) {
    if (!/^\d{1,10}$/.test(String(s.id || ''))) return null;
    const ep = /T(\d{1,3})\s*E(\d{1,4})/i.exec(String(s.titulo || ''));
    const alvo = ep ? { tipo: 'tv', tmdbId: String(s.id), temporada: Number(ep[1]), episodio: Number(ep[2]) } : { tipo: 'movie', tmdbId: String(s.id) };
    return { ...alvo, chave: alvo.tipo === 'tv' ? `tv:${alvo.tmdbId}:${alvo.temporada}:${alvo.episodio}` : `movie:${alvo.tmdbId}`, titulo: String(s.titulo || '').slice(0, 80) };
}

// Títulos que ABRIRAM, mas abaixo de 1080p nos últimos 7 dias (ex.: Dexter
// antigo, Jogos Vorazes em 720p). Série conta uma vez (o addon vale para todos
// os episódios). Também entram os pedidos de central/melhorar.json.
function titulosParaMelhorar(sessoes, { agora = Date.now(), pedidos = [] } = {}) {
    const limite = agora - 7 * 24 * 3600000;
    const porTitulo = new Map();
    for (const s of sessoes) {
        if (new Date(s.criadoEm).getTime() < limite) continue;
        const alvo = alvoDaSessao(s);
        if (!alvo) continue;
        const grupo = alvo.tipo + ':' + alvo.tmdbId;
        const tocou = (s.tentativas || []).filter(t => t.fonteId && /abriu|fechou|concluiu|tocando/.test(String(t.resultado || '')));
        const altura = Math.max(0, ...tocou.map(t => parseInt(t.resolucao, 10) || 0));
        if (!tocou.length) continue;
        const antes = porTitulo.get(grupo);
        // Se alguma vez o título já abriu em 1080p+, não precisa caçar.
        if (antes) { antes.altura = Math.max(antes.altura, altura); continue; }
        porTitulo.set(grupo, { ...alvo, altura, chave: 'qualidade:' + grupo });
    }
    // 800p/816p/960p/1040p são Full HD em tela larga (1920 de largura): não contam como baixa.
    const lista = [...porTitulo.values()].filter(a => a.altura > 0 && a.altura < 780);
    for (const p of pedidos) {
        const grupo = p.tipo + ':' + p.tmdbId;
        if (!lista.some(a => a.tipo + ':' + a.tmdbId === grupo)) lista.push({ ...p, altura: 0, chave: 'qualidade:' + grupo });
    }
    return lista;
}

function pedidosDeQualidade() {
    try {
        const dados = JSON.parse(fs.readFileSync(path.join(__dirname, 'melhorar.json'), 'utf8'));
        return (Array.isArray(dados.titulos) ? dados.titulos : []).filter(t => /^(movie|tv)$/.test(t.tipo) && /^\d{1,10}$/.test(String(t.tmdbId)))
            .map(t => ({ tipo: t.tipo, tmdbId: String(t.tmdbId), temporada: Number(t.temporada) || 1, episodio: Number(t.episodio) || 1, titulo: String(t.titulo || t.tmdbId).slice(0, 80) }));
    } catch { return []; }
}

// Espera entre caçadas do MESMO alvo: 6 h, 12 h, 24 h, 48 h… até 7 dias.
// Uma falha nova (depois da última caçada) volta a valer em 6 h. Assim o
// caçador não fica repetindo a mesma busca sem resultado a cada rodada.
function podeCacar(registro, { agora = Date.now(), ultimaFalha = 0 } = {}) {
    if (!registro) return true;
    const r = typeof registro === 'number' ? { em: registro, vezes: 1 } : registro;
    const espera = Math.min(7 * 24 * 3600000, REPETIR_TITULO * 2 ** Math.max(0, (Number(r.vezes) || 1) - 1));
    if (agora - Number(r.em || 0) >= espera) return true;
    return ultimaFalha > Number(r.em || 0) && agora - Number(r.em || 0) >= REPETIR_TITULO;
}
function anotarCacada(estado, chave, achou, agora = Date.now()) {
    const ant = estado.cacados[chave];
    const vezes = achou ? 0 : (typeof ant === 'number' ? 1 : Number(ant && ant.vezes) || 0) + 1;
    estado.cacados[chave] = { em: agora, vezes };
}

// Títulos que falharam e ainda não abriram depois (sessões da Central).
async function titulosQueFalharam(sessoesProntas) {
    const sessoes = sessoesProntas || await sessoesDaCentral();
    const limite = Date.now() - 48 * 3600000;
    const porTitulo = new Map();
    // As sessões vêm da mais nova para a mais antiga: a primeira de cada título decide.
    for (const s of sessoes) {
        if (new Date(s.criadoEm).getTime() < limite || !/^\d{1,10}$/.test(String(s.id || ''))) continue;
        const ep = /T(\d{1,3})\s*E(\d{1,4})/i.exec(String(s.titulo || ''));
        const alvo = ep ? { tipo: 'tv', tmdbId: String(s.id), temporada: Number(ep[1]), episodio: Number(ep[2]) } : { tipo: 'movie', tmdbId: String(s.id) };
        const chaveTitulo = alvo.tipo === 'tv' ? `tv:${alvo.tmdbId}:${alvo.temporada}:${alvo.episodio}` : `movie:${alvo.tmdbId}`;
        if (porTitulo.has(chaveTitulo)) continue;
        const abriu = s.resultado === 'abriu' || s.resultado === 'fechou' && (s.tentativas || []).some(t => t.fonteId);
        porTitulo.set(chaveTitulo, { ...alvo, titulo: String(s.titulo || chaveTitulo).slice(0, 80), falhou: !abriu && s.resultado === 'falhou', ultimaFalha: new Date(s.criadoEm).getTime() || 0 });
    }
    return [...porTitulo.entries()].filter(([, a]) => a.falhou).map(([chaveTitulo, a]) => ({ chave: chaveTitulo, ...a }));
}

// Fonte nova aprovada: fica registrada (o Painel mostra em destaque) e o
// Windows mostra um aviso no canto da tela.
function anunciarAprovada(ficha, extra = {}) {
    if (!ficha) return;
    const item = { em: new Date().toISOString(), nome: String(ficha.nome || ficha.id || '').slice(0, 60), qualidade: ficha.qualidade || '', origem: String((extra && (extra.cacadaPor || extra.adicionadaPor)) || ficha.origem || '').slice(0, 60) };
    try { fs.mkdirSync(PASTA, { recursive: true }); fs.appendFileSync(path.join(PASTA, 'aprovadas.jsonl'), JSON.stringify(item) + '\n'); } catch { /* segue */ }
    log(`★★★ FONTE NOVA APROVADA: ${item.nome}${item.qualidade ? ' (' + item.qualidade + ')' : ''} — já vale para o app`);
    if (process.platform !== 'win32') return;
    const texto = `${item.nome}${item.qualidade ? ' · ' + item.qualidade : ''} entrou no app.`.replace(/'/g, "''");
    const script = [
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        "$t = $x.GetElementsByTagName('text')",
        "$t.Item(0).AppendChild($x.CreateTextNode('Conecta TV: fonte nova aprovada')) | Out-Null",
        `$t.Item(1).AppendChild($x.CreateTextNode('${texto}')) | Out-Null`,
        "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))",
    ].join('; ');
    try { const { spawn } = require('child_process'); spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true, detached: true }).on('error', () => {}).unref(); } catch { /* sem aviso */ }
}

function lerEstado() { try { return JSON.parse(fs.readFileSync(path.join(PASTA, 'estado.json'), 'utf8')); } catch { return { cacados: {}, ultimaRondaNovelas: 0 }; } }
function gravarEstado(estado) { try { fs.mkdirSync(PASTA, { recursive: true }); fs.writeFileSync(path.join(PASTA, 'estado.json'), JSON.stringify(estado, null, 1)); } catch { /* segue */ } }

function dependencias() {
    return {
        buscarJson,
        sondar: sondagemRapida,
        validar: fichas.validar,
        registrarFicha: (pasta, ficha, avaliacao, extra) => { const reg = fichas.registrarFicha(pasta, ficha, avaliacao, extra); anunciarAprovada(reg, extra); return reg; },
        fichasAtuais: () => { try { return require('../perfis-locais').perfis().concat(fichas.listar(PASTA)); } catch { return fichas.listar(PASTA); } },
        confirmarIdioma: confirmadorDeIdioma(),
        pastaDados: PASTA,
        fixos: varredor.ADDONS.filter(a => !/cinemeta|opensubtitles/i.test(a.nome)).map(a => ({ nome: a.nome, base: a.base, tipos: ['movie', 'series'], brasileiro: true })),
        registrar: texto => log('  ' + texto),
    };
}

async function cacarUm(alvo, deps) {
    const r = await cacada.cacarTitulo(alvo, deps);
    if (r.erro) log(`${alvo.titulo}: ${r.erro}`);
    else log(`${alvo.titulo}: ${r.consultados} addons consultados, ${r.responderam.length} têm o título, ${r.aprovadas.length} ficha(s) nova(s) aprovada(s) em ${Math.round(r.ms / 1000)}s`);
    return r;
}

// Fichas ativas cujo vídeo está em servidor com certificado https inválido não
// tocam no celular nem no navegador (erro 4): são desligadas e publicadas.
async function conferirCertificados({ checar = require('./verificar-midia').certificadoValido } = {}) {
    const dados = fichas.ler(PASTA);
    const desligadas = [];
    for (const f of dados.perfis) {
        if (f.ativo === false) continue;
        const urls = (f.provas || []).map(p => p && p.url).filter(u => /^https:\/\//.test(String(u || ''))).slice(0, 2);
        if (!urls.length) continue;
        const r = await Promise.all(urls.map(u => checar(u).catch(() => ({ ok: true }))));
        if (r.every(x => !x.ok)) {
            f.ativo = false; f.desligadaEm = new Date().toISOString();
            f.motivoDesligada = `certificado https inválido no servidor do vídeo (${r[0].erro}) — o app não toca`;
            desligadas.push(f.nome || f.id);
            log(`✘ ${f.nome || f.id} desligada: ${f.motivoDesligada}`);
        }
    }
    if (desligadas.length) fichas.gravar(PASTA, dados);
    return desligadas;
}

async function rodada({ forcarNovelas = false } = {}) {
    const deps = dependencias();
    const estado = lerEstado();
    let novas = 0;
    const desligadas = await conferirCertificados().catch(() => []);
    if (desligadas.length) novas += desligadas.length; // força publicar a lista corrigida
    if (!deps.confirmarIdioma) log('aviso: sem chave da IA (api.txt) — arquivos sem etiqueta de idioma não podem ser comprovados');

    // 1. Títulos que falharam para alguém.
    let falhas = [], sessoes = [];
    try { sessoes = await sessoesDaCentral(); falhas = await titulosQueFalharam(sessoes); log(`Central: ${falhas.length} título(s) com falha nas últimas 48 h`); }
    catch (erro) { log(`não consegui ler a Central (${erro.message}). Abra o túnel com o Abrir-Central.cmd ou deixe este atalho abrir.`); }
    const pendentes = falhas.filter(f => podeCacar(estado.cacados[f.chave], { ultimaFalha: f.ultimaFalha }));
    if (falhas.length > pendentes.length) log(`  ${falhas.length - pendentes.length} já caçado(s) há pouco, sem fonte nova: ficam para depois (espera maior a cada tentativa)`);
    for (const alvo of pendentes.slice(0, MAX_POR_RODADA)) {
        const r = await cacarUm(alvo, deps).catch(erro => { log(`${alvo.titulo}: erro ${erro.message}`); return null; });
        anotarCacada(estado, alvo.chave, Boolean(r && r.aprovadas.length));
        if (r) novas += r.aprovadas.length;
        gravarEstado(estado);
    }

    // 2. Caça de qualidade: títulos que abriram abaixo de 1080p.
    const melhorar = titulosParaMelhorar(sessoes, { pedidos: pedidosDeQualidade() }).filter(a => podeCacar(estado.cacados[a.chave]));
    if (melhorar.length) log(`qualidade: ${melhorar.length} título(s) para procurar em 1080p ou mais`);
    for (const alvo of melhorar.slice(0, 3)) {
        log(`  ${alvo.titulo}${alvo.altura ? ` abriu em ${alvo.altura}p` : ''} — procurando versão dublada em 1080p+`);
        const r = await cacada.cacarTitulo(alvo, { ...deps, alturaMinima: 1080 }).catch(erro => { log(`${alvo.titulo}: erro ${erro.message}`); return null; });
        if (r) log(`${alvo.titulo}: ${r.consultados} addons consultados, ${r.responderam.length} têm o título, ${r.aprovadas.length} fonte(s) 1080p+ aprovada(s)`);
        anotarCacada(estado, alvo.chave, Boolean(r && r.aprovadas.length));
        if (r) novas += r.aprovadas.length;
        gravarEstado(estado);
    }

    // 3. Ronda das novelas: o capítulo recente de cada novela em exibição.
    // Capítulo já caçado sem sucesso espera mais (não repete a mesma busca a
    // cada ronda); a vez passa para as outras novelas da lista.
    if (forcarNovelas || Date.now() - Number(estado.ultimaRondaNovelas || 0) > RONDA_NOVELAS) {
        const novelas = await cacada.novelasAtuais(buscarJson).catch(() => cacada.NOVELAS_FIXAS);
        const chaveDe = n => `tv:${n.id}:${n.temporada}:${n.episodio}`;
        const daVez = novelas.filter(n => podeCacar(estado.cacados[chaveDe(n)]));
        log(`ronda das novelas: ${novelas.length} em exibição, ${daVez.length} com capítulo para procurar`);
        for (const n of daVez.slice(0, 6)) {
            const r = await cacarUm({ tipo: 'tv', tmdbId: n.id, imdb: n.imdb, temporada: n.temporada, episodio: n.episodio, titulo: n.titulo }, deps).catch(() => null);
            anotarCacada(estado, chaveDe(n), Boolean(r && r.aprovadas.length));
            if (r) novas += r.aprovadas.length;
        }
        estado.ultimaRondaNovelas = Date.now();
        gravarEstado(estado);
    }

    // 4. Investigação: fonte que caiu é rastreada até o endereço novo.
    const dossies = await investigarFontes({ estado, limite: 2 }).catch(erro => { log('investigação com erro: ' + erro.message); return []; });
    novas += dossies.flatMap(d => d.validacao || []).filter(v => v.status === 'aprovada').length;
    gravarEstado(estado);

    // 4b. Descoberta: fornecedores novos, mesmo sem ninguém reclamar.
    novas += await descobrir({ estado }).catch(erro => { log('descoberta com erro: ' + erro.message); return 0; });
    gravarEstado(estado);

    // 5. Publica (juntando com o que já está publicado).
    if (novas > 0) {
        const token = tokenDoGithub();
        const pub = await fichas.publicar(PASTA, token);
        log(pub.ok ? `publicado no GitHub: ${pub.perfis} ficha(s) ativas — o celular passa a usar em alguns minutos` : `não publiquei (${pub.motivo}). Coloque o token em %USERPROFILE%\\.streamtv\\github-token.txt`);
    }
    return novas;
}

// ------------------------------------------------------------------ descoberta
// Coleta candidatos (catálogos, diretórios, GitHub, pistas), procura fonte que
// mudou de endereço e testa os mais promissores. Ver central/descoberta.js.
async function descobrir({ estado = lerEstado(), quantos = 12, forcar = false } = {}) {
    const descoberta = require('./descoberta');
    const deps = dependencias();
    const memoria = descoberta.criarMemoria(PASTA);
    const reg = deps.registrar;
    const marca = estado.descoberta || (estado.descoberta = {});
    const vencido = (chave, ms) => forcar || Date.now() - Number(marca[chave] || 0) > ms;
    log('descoberta: procurando fornecedores novos');
    await descoberta.coletarCatalogos(memoria, { buscarJson, pastaDados: PASTA, registrar: reg });
    let fontesExtras = [];
    try { fontesExtras = JSON.parse(fs.readFileSync(path.join(__dirname, 'descoberta-fontes.json'), 'utf8')).diretorios || []; } catch { /* só as padrão */ }
    if (vencido('diretoriosEm', 24 * 3600000)) {
        await descoberta.coletarDiretorios(memoria, { buscarTexto: buscarTextoSimples, diretorios: [...descoberta.DIRETORIOS_PADRAO, ...fontesExtras.filter(u => /^https:\/\//.test(u))], registrar: reg });
        marca.diretoriosEm = Date.now();
    }
    if (vencido('githubEm', 24 * 3600000)) {
        await descoberta.coletarGithub(memoria, { buscarJson, buscarTexto: buscarTextoSimples, token: tokenDoGithub(), registrar: reg });
        marca.githubEm = Date.now();
    }
    await descoberta.detetive(memoria, { fichas: deps.fichasAtuais(), buscarJson, registrar: reg });
    const { players } = await descoberta.coletarPistas(memoria, { buscarTexto: buscarTextoSimples, registrar: reg });
    const resultados = [];
    // Players achados nas pistas: só os que trazem o número do título.
    const vistos = new Set(marca.playersTestados || []);
    const { moldeDePlayer, hostDe } = require('./extrair-fornecedores');
    for (const p of players.filter(p => moldeDePlayer(p)).slice(0, 6)) {
        const chave = hostDe(p) + '|' + moldeDePlayer(p).modelo;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        resultados.push(await cacada.verificarPlayer(p, deps).catch(e => ({ link: p, nome: hostDe(p), status: 'recusada', detalhe: String(e.message || e).slice(0, 80) })));
        if (resultados.length >= 3) break;
    }
    marca.playersTestados = [...vistos].slice(-300);
    resultados.push(...await descoberta.explorar(memoria, deps, { quantos }));
    memoria.gravar();
    const aprovadas = resultados.filter(r => r.status === 'aprovada').length;
    const rel = descoberta.relatorio(memoria, { dias: 7 });
    log(`descoberta: ${rel.conhecidos} fornecedores conhecidos, ${rel.naFila} na fila, ${aprovadas} aprovado(s) nesta rodada`);
    descobrir.ultimos = resultados;
    return aprovadas;
}

// ------------------------------------------------------------------ investigação
// Fonte que caiu/mudou: o investigador junta pistas e procura o endereço novo.
function descartadasQueSumiram() {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'fontes.json'), 'utf8'));
        // Só os sites brasileiros que sumiram (os embeds gringos eram legendados).
        return (j.descartadas || []).filter(d => /n[ãa]o responderam/i.test(d.motivo || ''))
            .flatMap(d => String(d.nome || '').split(/,\s*|\s+e\s+/)).map(s => s.trim()).filter(s => s && !/vidsrc|embed|api\b/i.test(s));
    } catch { return []; }
}

async function investigarFontes({ alvo = '', estado = lerEstado(), limite = 4, forcar = false } = {}) {
    const investigador = require('./investigador');
    const descoberta = require('./descoberta');
    const deps = dependencias();
    const memoria = descoberta.criarMemoria(PASTA);
    let casos;
    if (alvo) {
        const url = /^https?:\/\//i.test(alvo) ? alvo : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(alvo) ? 'https://' + alvo : '';
        casos = [{ nome: url ? new URL(url).hostname.replace(/^www\./, '') : alvo, enderecos: url ? [url] : [], origem: 'pedido no painel' }];
    } else {
        const marcas = estado.investigacoes || (estado.investigacoes = {});
        casos = investigador.casosAutomaticos({ fichas: deps.fichasAtuais(), memoria, descartadas: descartadasQueSumiram() })
            .filter(c => forcar || Date.now() - Number(marcas[c.nome] || 0) > 3 * 24 * 3600000)
            // Quem foi investigado há mais tempo (ou nunca) vem primeiro.
            .sort((a, b) => Number(marcas[a.nome] || 0) - Number(marcas[b.nome] || 0)).slice(0, limite);
        for (const c of casos) marcas[c.nome] = Date.now();
    }
    if (!casos.length) { log('investigação: nenhuma fonte caída pendente (cada uma é revista a cada 3 dias)'); return []; }
    log(`investigação: ${casos.length} fonte(s) para rastrear`);
    const dossies = [];
    for (const caso of casos) {
        dossies.push(await investigador.investigar(caso, {
            obter: investigador.criarObter(axios, UA), buscarJson, memoria, token: tokenDoGithub(), pasta: PASTA, registrar: deps.registrar,
            verificarLinks: links => cacada.verificarLinks(links, deps),
            verificarPaginas: links => cacada.verificarPaginas(links, deps),
            explorarSite: url => cacada.explorarSite(url, { ...deps, espionar: (u, o) => require('./verificar-navegador').espionarPagina(u, o) }),
        }).catch(erro => ({ caso, conclusao: 'erro: ' + erro.message, candidatos: [], validacao: [] })));
    }
    memoria.gravar();
    return dossies;
}

// Erros recentes da Central em texto simples (o Painel mostra e grava em
// central/dados-pc/erros-recentes.txt para conferir depois).
function errosRecentes(sessoes, { horas = 48, filtro = '', agora = Date.now() } = {}) {
    const limite = agora - horas * 3600000;
    const f = String(filtro || '').toLowerCase();
    const linhas = [];
    const hora = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (const s of sessoes) {
        if (Date.parse(s.criadoEm) < limite) continue;
        if (f && !String(s.titulo || '').toLowerCase().includes(f)) continue;
        const falhou = (s.tentativas || []).some(t => /falhou/.test(t.resultado || ''));
        if (!falhou && !f) continue;
        linhas.push(`■ ${hora(s.criadoEm)} · ${s.titulo || s.id || '?'} · ${s.nome || s.dispositivo || ''} (${[s.aparelho, s.app, s.versao].filter(Boolean).join(' ')})`);
        for (const t of s.tentativas || []) {
            const motivos = [...new Set((t.historico || []).map(h => h.motivo).filter(Boolean))].slice(-3);
            linhas.push(`   tentativa ${t.tentativa}: ${t.resultado}${t.fonte || t.fonteId ? ' · fonte ' + (t.fonte || t.fonteId) : ''}${t.resolucao ? ' · ' + t.resolucao : ''}${t.audio ? ' · ' + t.audio : ''}${t.motivo ? ' · ' + t.motivo : ''}`);
            for (const m of motivos) if (m !== t.motivo) linhas.push(`      - ${m}`);
        }
    }
    return linhas;
}

function resumoDaDescoberta() {
    const descoberta = require('./descoberta');
    const rel = descoberta.relatorio(descoberta.criarMemoria(PASTA), { dias: 7 });
    const nomes = { novo: 'na fila (nunca testados)', aprovada: 'aprovados', 'já ativa': 'já usados pelo app', recusada: 'recusados na validação', promissora: 'promissores', 'sem dublado': 'sem dublado', 'fora do ar': 'fora do ar', 'pede configuração': 'pedem configuração', 'conta paga': 'pedem conta paga', 'sem vídeo': 'sem filmes/séries', erro: 'com erro' };
    const linhas = [
        `Fornecedores conhecidos: ${rel.conhecidos} · vistos pela primeira vez na semana: ${rel.vistosNoPeriodo}`,
        `Testados na semana: ${rel.testadosNoPeriodo} · aprovados: ${rel.aprovadasNoPeriodo} · na fila para testar: ${rel.naFila}`,
        'Situação: ' + Object.entries(rel.porStatus).map(([k, v]) => `${v} ${nomes[k] || k}`).join(' · '),
        'De onde vieram: ' + Object.entries(rel.porOrigem).map(([k, v]) => `${k} ${v}`).join(' · '),
        ...rel.mudancas.map(m => 'Possível mudança de endereço: ' + m.detalhe),
    ];
    return { rel, linhas };
}

async function principal() {
    const args = process.argv.slice(2);
    log('Caçador no PC iniciado');
    if (args[0] === '--titulo') {
        const [tipo, tmdbId, temporada, episodio] = String(args[1] || '').split(':');
        const alvo = tipo === 'tv' ? { tipo: 'tv', tmdbId, temporada: Number(temporada) || 1, episodio: Number(episodio) || 1 } : { tipo: 'movie', tmdbId };
        alvo.titulo = args[2] || args[1];
        const r = await cacarUm(alvo, dependencias());
        if (r.aprovadas && r.aprovadas.length) { const pub = await fichas.publicar(PASTA, tokenDoGithub()); log(pub.ok ? 'publicado no GitHub' : 'não publiquei: ' + pub.motivo); }
        return;
    }
    if (args[0] === '--incluir') {
        // Inclui uma fonte já encontrada (ex.: central/fichas/bestcine.json),
        // mas só depois de VALIDAR aqui: filmes e séries separados, com prova
        // de imagem e de áudio em português em títulos diferentes.
        const ficha = JSON.parse(fs.readFileSync(path.resolve(RAIZ, args[1]), 'utf8'));
        const amostras = Array.isArray(ficha.amostras) ? ficha.amostras : [];
        delete ficha.amostras; delete ficha.comoLer;
        const deps = dependencias();
        const tiposAprovados = [];
        let melhor = null;
        for (const tipo of ['movie', 'tv']) {
            const lista = amostras.filter(a => a.tipo === tipo);
            if (!lista.length || !(ficha.tipos || []).includes(tipo)) continue;
            log(`validando ${ficha.nome} em ${tipo === 'tv' ? 'séries/novelas' : 'filmes'}...`);
            const r = await fichas.validar(ficha, lista, { registrar: deps.registrar, confirmarIdioma: deps.confirmarIdioma });
            log(r.aprovada ? `  aprovada (${r.ajustes.qualidade}, nota ${r.ajustes.nota})` : `  reprovada: ${r.motivo}`);
            if (r.aprovada) { tiposAprovados.push(tipo); if (!melhor || r.ajustes.nota > melhor.ajustes.nota) melhor = r; }
        }
        if (!melhor) { log('nada incluído: a fonte não passou na validação.'); process.exitCode = 2; return; }
        const final = { ...ficha, tipos: tiposAprovados };
        if (!tiposAprovados.includes('movie')) delete final.urlMovie;
        if (!tiposAprovados.includes('tv')) delete final.urlTv;
        const registrada = fichas.registrarFicha(PASTA, final, melhor, { incluidaEm: new Date().toISOString() });
        log(`${registrada.nome} incluída para ${tiposAprovados.map(t => t === 'tv' ? 'séries' : 'filmes').join(' e ')}`);
        const pub = await fichas.publicar(PASTA, tokenDoGithub());
        log(pub.ok ? `publicado no GitHub (${pub.perfis} fichas ativas). O app passa a usar em alguns minutos.` : `não publiquei: ${pub.motivo}`);
        if (!pub.ok) process.exitCode = 3;
        return;
    }
    if (args[0] === '--links' || args[0] === '--paginas') {
        // Links que o usuário colou (no painel ou em central/fontes-minhas.txt):
        // podem ser PÁGINAS de sites ou addons. De cada página o caçador extrai
        // os fornecedores (addons e players embutidos) e confere cada um como
        // qualquer fonte. Quem entrega vídeo dublado em HD, sem login e sem
        // anúncio, é ativado e publicado para o app.
        const arquivo = args[0] === '--paginas' && args[1] ? path.resolve(args[1]) : path.join(RAIZ, 'central', 'fontes-minhas.txt');
        let linhas = [];
        try { linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); }
        catch { log(`não achei ${arquivo}.`); process.exitCode = 2; return; }
        if (!linhas.length) { log('nenhum link para conferir.'); return; }
        log(`conferindo ${linhas.length} link(s)…`);
        const deps = dependencias();
        try { const robo = require('./verificar-navegador'); deps.espionar = (url, o) => robo.espionarPagina(url, o); } catch { /* sem navegador escondido */ }
        const { paginas, resultados } = await cacada.verificarPaginas(linhas, deps);
        log('--- resultado ---');
        for (const p of paginas) log(`página ${p.link}: ${p.addons} addon(s), ${p.players} player(s), ${p.videos} vídeo(s)${p.aviso ? ' — ' + p.aviso : ''}`);
        for (const r of resultados) log(`${r.status === 'aprovada' ? '✔' : /^já/.test(r.status) ? '•' : /ignorado|código próprio/.test(r.status) ? '·' : '✘'} ${r.nome || r.link}: ${r.status}${r.qualidade ? ' ' + r.qualidade : ''}${r.detalhe ? ' — ' + r.detalhe : ''}`);
        const aprovadas = resultados.filter(r => r.status === 'aprovada' || r.atualizada);
        let publicado = null;
        if (aprovadas.length) {
            publicado = await fichas.publicar(PASTA, tokenDoGithub());
            log(publicado.ok ? `publicado no GitHub (${publicado.perfis} fichas ativas). O app passa a usar em alguns minutos.` : `não publiquei: ${publicado.motivo}`);
            if (!publicado.ok) process.exitCode = 3;
        } else log('nenhuma fonte nova aprovada desta vez.');
        // Linha para o painel montar a tabela de resultados.
        console.log('RESULTADO:' + JSON.stringify({ paginas, resultados, publicado: publicado ? publicado.ok : null }));
        return;
    }
    if (args[0] === '--explorar') {
        const estado = lerEstado();
        const aprovadas = await descobrir({ estado, quantos: 40, forcar: true });
        gravarEstado(estado);
        let publicado = null;
        if (aprovadas) { publicado = await fichas.publicar(PASTA, tokenDoGithub()); log(publicado.ok ? `publicado no GitHub (${publicado.perfis} fichas ativas)` : 'não publiquei: ' + publicado.motivo); }
        const { linhas } = resumoDaDescoberta();
        linhas.forEach(l => log(l));
        console.log('RESULTADO:' + JSON.stringify({ resumo: linhas, resultados: descobrir.ultimos || [], publicado: publicado ? publicado.ok : null }));
        return;
    }
    if (args[0] === '--investigar') {
        const estado = lerEstado();
        const dossies = await investigarFontes({ alvo: String(args[1] || '').trim(), estado, forcar: true, limite: 6 });
        gravarEstado(estado);
        const aprovadas = dossies.flatMap(d => d.validacao || []).filter(v => v.status === 'aprovada').length;
        let publicado = null;
        if (aprovadas) { publicado = await fichas.publicar(PASTA, tokenDoGithub()); log(publicado.ok ? `publicado no GitHub (${publicado.perfis} fichas ativas)` : 'não publiquei: ' + publicado.motivo); }
        const resumo = dossies.map(d => `${d.caso.nome}: ${d.conclusao}`);
        const resultados = dossies.flatMap(d => [
            ...(d.validacao || []).map(v => ({ nome: `${d.caso.nome} → ${v.dominio}`, link: v.link, status: v.status, detalhe: v.detalhe || v.qualidade || '' })),
            ...(d.candidatos || []).slice(0, 8).map(c => ({ nome: `${d.caso.nome} → ${c.dominio}`, link: c.url, status: c.nota >= 6 ? 'forte' : c.nota > 0 ? 'pista' : 'descartado', detalhe: `nota ${c.nota} · ${c.motivo} · ${c.evidencia}` })),
        ]);
        console.log('RESULTADO:' + JSON.stringify({ resumo, resultados, publicado: publicado ? publicado.ok : null }));
        return;
    }
    if (args[0] === '--erros') {
        const filtro = String(args[1] || '').trim();
        let sessoes = [];
        try { sessoes = await sessoesDaCentral(); } catch (erro) { log(`não consegui ler a Central (${erro.message}). Abra a Central (túnel) e tente de novo.`); process.exitCode = 2; return; }
        const linhas = errosRecentes(sessoes, { filtro, horas: filtro ? 24 * 7 : 48 });
        const texto = [`Erros da Central${filtro ? ' com "' + filtro + '"' : ' (últimas 48 h)'} — ${new Date().toLocaleString('pt-BR')}`, '', ...(linhas.length ? linhas : ['nenhum erro registrado nesse período'])].join('\n');
        try { fs.mkdirSync(PASTA, { recursive: true }); fs.writeFileSync(path.join(PASTA, 'erros-recentes.txt'), texto); } catch { /* segue */ }
        console.log(texto);
        return;
    }
    if (args[0] === '--descobertas') {
        const { rel, linhas } = resumoDaDescoberta();
        linhas.forEach(l => log(l));
        console.log('RESULTADO:' + JSON.stringify({ resumo: linhas, resultados: rel.ultimos, publicado: null }));
        return;
    }
    if (args.includes('--uma-vez')) { await rodada({ forcarNovelas: args.includes('--novelas') }); return; }
    for (;;) {
        await rodada().catch(erro => log('rodada com erro: ' + erro.message));
        log(`próxima rodada em ${INTERVALO / 60000} min (deixe esta janela aberta)`);
        await new Promise(r => setTimeout(r, INTERVALO));
    }
}

if (require.main === module) principal().catch(erro => { log('erro: ' + erro.message); process.exitCode = 1; });
module.exports = { conferirCertificados, errosRecentes, anunciarAprovada, investigarFontes, descartadasQueSumiram, descobrir, resumoDaDescoberta, titulosQueFalharam, titulosParaMelhorar, podeCacar, anotarCacada, rodada, chaveDaCentral };
