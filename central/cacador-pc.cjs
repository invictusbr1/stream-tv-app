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

async function buscarJson(url) {
    const r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': UA, Accept: 'application/json' }, maxContentLength: 8 * 1024 * 1024, validateStatus: s => s < 500 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
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

// Títulos que falharam e ainda não abriram depois (sessões da Central).
async function titulosQueFalharam() {
    const chave = chaveDaCentral();
    const r = await axios.get(CENTRAL + '/api/reproducao', { timeout: 15000, headers: chave ? { 'x-chave': chave } : {}, validateStatus: s => s < 500 });
    if (r.status !== 200) throw new Error(r.status === 401 || r.status === 403 ? 'a Central recusou a chave' : 'Central respondeu ' + r.status);
    const sessoes = Array.isArray(r.data && r.data.sessoes) ? r.data.sessoes : [];
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
        porTitulo.set(chaveTitulo, { ...alvo, titulo: String(s.titulo || chaveTitulo).slice(0, 80), falhou: !abriu && s.resultado === 'falhou' });
    }
    return [...porTitulo.entries()].filter(([, a]) => a.falhou).map(([chaveTitulo, a]) => ({ chave: chaveTitulo, ...a }));
}

function lerEstado() { try { return JSON.parse(fs.readFileSync(path.join(PASTA, 'estado.json'), 'utf8')); } catch { return { cacados: {}, ultimaRondaNovelas: 0 }; } }
function gravarEstado(estado) { try { fs.mkdirSync(PASTA, { recursive: true }); fs.writeFileSync(path.join(PASTA, 'estado.json'), JSON.stringify(estado, null, 1)); } catch { /* segue */ } }

function dependencias() {
    return {
        buscarJson,
        sondar: sondagemRapida,
        validar: fichas.validar,
        registrarFicha: fichas.registrarFicha,
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

async function rodada({ forcarNovelas = false } = {}) {
    const deps = dependencias();
    const estado = lerEstado();
    let novas = 0;
    if (!deps.confirmarIdioma) log('aviso: sem chave da IA (api.txt) — arquivos sem etiqueta de idioma não podem ser comprovados');

    // 1. Títulos que falharam para alguém.
    let falhas = [];
    try { falhas = await titulosQueFalharam(); log(`Central: ${falhas.length} título(s) com falha nas últimas 48 h`); }
    catch (erro) { log(`não consegui ler a Central (${erro.message}). Abra o túnel com o Abrir-Central.cmd ou deixe este atalho abrir.`); }
    const pendentes = falhas.filter(f => Date.now() - Number(estado.cacados[f.chave] || 0) > REPETIR_TITULO).slice(0, MAX_POR_RODADA);
    for (const alvo of pendentes) {
        const r = await cacarUm(alvo, deps).catch(erro => { log(`${alvo.titulo}: erro ${erro.message}`); return null; });
        estado.cacados[alvo.chave] = Date.now();
        if (r) novas += r.aprovadas.length;
        gravarEstado(estado);
    }

    // 2. Ronda das novelas: o capítulo recente de cada novela em exibição.
    if (forcarNovelas || Date.now() - Number(estado.ultimaRondaNovelas || 0) > RONDA_NOVELAS) {
        const novelas = await cacada.novelasAtuais(buscarJson).catch(() => cacada.NOVELAS_FIXAS);
        log(`ronda das novelas: ${novelas.length} em exibição`);
        for (const n of novelas.slice(0, 6)) {
            const r = await cacarUm({ tipo: 'tv', tmdbId: n.id, imdb: n.imdb, temporada: n.temporada, episodio: n.episodio, titulo: n.titulo }, deps).catch(() => null);
            if (r) novas += r.aprovadas.length;
        }
        estado.ultimaRondaNovelas = Date.now();
        gravarEstado(estado);
    }

    // 3. Publica (juntando com o que já está publicado).
    if (novas > 0) {
        const token = tokenDoGithub();
        const pub = await fichas.publicar(PASTA, token);
        log(pub.ok ? `publicado no GitHub: ${pub.perfis} ficha(s) ativas — o celular passa a usar em alguns minutos` : `não publiquei (${pub.motivo}). Coloque o token em %USERPROFILE%\\.streamtv\\github-token.txt`);
    }
    return novas;
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
    if (args.includes('--uma-vez')) { await rodada({ forcarNovelas: args.includes('--novelas') }); return; }
    for (;;) {
        await rodada().catch(erro => log('rodada com erro: ' + erro.message));
        log(`próxima rodada em ${INTERVALO / 60000} min (deixe esta janela aberta)`);
        await new Promise(r => setTimeout(r, INTERVALO));
    }
}

if (require.main === module) principal().catch(erro => { log('erro: ' + erro.message); process.exitCode = 1; });
module.exports = { titulosQueFalharam, rodada, chaveDaCentral };
