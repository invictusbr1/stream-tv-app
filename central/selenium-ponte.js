'use strict';
// Ponte entre o caçador (Node) e o SeleniumBase (Python), só no PC.
//
// O caçador já tem o navegador escondido do puppeteer (verificar-navegador.js).
// A ponte acrescenta o SeleniumBase do jeito que estiver em
// central/configuracao-caca.json (ligado/desligado, reserva ou sempre, janela
// visível, anúncios, tempos e o que fazer com verificação de robô).
//
// Sem Python ou sem SeleniumBase (ex.: no servidor Oracle) a ponte só avisa e
// devolve o resultado original — nada quebra.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'selenium-ponte.py');
const ARQ_CONFIG = path.join(__dirname, 'configuracao-caca.json');
const PADRAO = Object.freeze({
    seleniumbase_ligado: true, quando_usar: 'reserva', janela_visivel: false, bloquear_anuncios: true,
    segundos_observando: 15, tempo_para_abrir: 25, verificacao_de_robo: 'recusar', tempo_para_voce_resolver: 180, python: '',
});

function faixa(valor, padrao, min, max) { const n = Number(valor); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao; }

// Lê a configuração a cada uso (editar o arquivo vale na próxima página).
// Valor faltando ou errado cai no padrão; o arquivo nunca derruba o caçador.
// Perdoa os erros mais comuns de quem edita na mão: chaves { } apagadas e
// vírgula sobrando no fim. Se mesmo assim não der, avisa no log.
let ultimoAviso = '';
function interpretar(texto) {
    let t = String(texto || '').replace(/^\uFEFF/, '').trim();
    if (!t.startsWith('{')) t = '{' + t;
    if (!t.endsWith('}')) t = t + '}';
    t = t.replace(/,\s*}$/, '}');
    return JSON.parse(t);
}
function lerConfig(arquivo = ARQ_CONFIG, ler = fs.readFileSync) {
    let bruto = {};
    ultimoAviso = '';
    let texto = null;
    try { texto = ler(arquivo, 'utf8'); } catch { /* sem arquivo: padrão */ }
    if (texto !== null) {
        try { bruto = interpretar(texto); }
        catch (e) { bruto = {}; ultimoAviso = 'configuracao-caca.json com erro de digitação (' + String(e.message || e).slice(0, 60) + '); usando o padrão'; }
    }
    const c = { ...PADRAO, ...bruto };
    return {
        ligado: c.seleniumbase_ligado !== false,
        sempre: String(c.quando_usar).toLowerCase() === 'sempre',
        visivel: c.janela_visivel === true,
        bloquear: c.bloquear_anuncios !== false,
        segundos: faixa(c.segundos_observando, 15, 4, 45),
        abrir: faixa(c.tempo_para_abrir, 25, 5, 90),
        robo: String(c.verificacao_de_robo).toLowerCase() === 'manual' ? 'manual' : 'recusar',
        resolver: faixa(c.tempo_para_voce_resolver, 180, 30, 600),
        python: typeof c.python === 'string' ? c.python.trim() : '',
    };
}

function pythonDoPc(config = {}) {
    if (config.python) return config.python;
    if (process.env.SELENIUMBASE_PYTHON) return process.env.SELENIUMBASE_PYTHON;
    return process.platform === 'win32' ? 'python' : 'python3';
}

function vazio(r) {
    if (!r) return true;
    return !((r.videos || []).length || (r.molduras || []).length || (r.api || []).length);
}

function espionarComSelenium(url, { referer = '', registrar = () => {}, signal, rodar = spawn, config = lerConfig() } = {}) {
    return new Promise(resolve => {
        const args = [SCRIPT, String(url), '--segundos', String(config.segundos), '--abrir', String(config.abrir),
            '--robo', config.robo, '--resolver', String(config.resolver)];
        if (referer) args.push('--referer', String(referer));
        if (config.visivel) args.push('--visivel');
        if (!config.bloquear) args.push('--sem-bloqueio');
        let saida = '', resto = '', terminou = false, filho;
        const falha = erro => ({ ok: false, erro, videos: [], pedidos: [], molduras: [], api: [], semRobo: true });
        const acabar = r => { if (terminou) return; terminou = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', cancelar); resolve(r); };
        const prazo = (config.abrir * 2 + config.segundos + (config.robo === 'manual' ? config.resolver : 0)) * 1000 + 60000;
        const timer = setTimeout(() => { matar(); acabar(falha('SeleniumBase demorou demais')); }, prazo);
        const matar = () => { try { filho && filho.kill(); } catch { /* já saiu */ } };
        const cancelar = () => { matar(); acabar(falha('sondagem cancelada')); };
        try { filho = rodar(pythonDoPc(config), args, { windowsHide: !config.visivel, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); }
        catch (e) { return acabar(falha('Python não encontrado (' + String(e.message || e).slice(0, 60) + ')')); }
        if (signal) { signal.addEventListener('abort', cancelar, { once: true }); if (signal.aborted) cancelar(); }
        if (filho.stdout) filho.stdout.on('data', d => {
            saida += d; if (saida.length > 4e6) saida = saida.slice(-4e6);
            resto += d; const linhas = resto.split(/\r?\n/); resto = linhas.pop();
            for (const l of linhas) if (l.startsWith('AVISO:')) registrar('SeleniumBase: ' + l.slice(6));
        });
        filho.on('error', e => acabar(falha('Python não encontrado (' + String(e.message || e).slice(0, 60) + ')')));
        filho.on('close', () => {
            const linha = saida.split(/\r?\n/).reverse().find(l => l.startsWith('PONTE:'));
            if (!linha) return acabar(falha('SeleniumBase não respondeu'));
            try { acabar(JSON.parse(linha.slice(6))); } catch { acabar(falha('resposta inválida do SeleniumBase')); }
        });
        registrar(`abrindo a página pelo SeleniumBase${config.visivel ? ' (janela visível)' : ''}…`);
    });
}

// Envolve um espionar existente seguindo a configuração:
//  - desligado: só o original;  - reserva: original primeiro, SeleniumBase se falhar;
//  - sempre: SeleniumBase primeiro, original se o SeleniumBase não estiver disponível.
function comSelenium(espionarOriginal, { espionarSelenium = espionarComSelenium, config = null } = {}) {
    const original = async (url, opcoes) => typeof espionarOriginal === 'function'
        ? Promise.resolve().then(() => espionarOriginal(url, opcoes)).catch(() => null) : null;
    return async (url, opcoes = {}) => {
        const cfg = config || lerConfig();
        const registrar = opcoes.registrar || (() => {});
        if (!config && ultimoAviso) registrar('ATENÇÃO: ' + ultimoAviso);
        if (!cfg.ligado) return original(url, opcoes);
        let r = null;
        if (!cfg.sempre) {
            r = await original(url, opcoes);
            if (r && r.ok && !vazio(r)) return r;
        }
        const s = await espionarSelenium(url, { ...opcoes, config: cfg });
        if (s && s.captcha) { registrar('SeleniumBase: ' + s.erro); return r || { ...s, semRobo: false }; }
        if (s && s.ok) { if (!vazio(s)) registrar(`SeleniumBase achou ${s.videos.length} vídeo(s) e ${s.molduras.length} player(s)`); return s; }
        if (s && s.erro) registrar('SeleniumBase indisponível: ' + s.erro);
        if (cfg.sempre) return (await original(url, opcoes)) || s;
        return r || s;
    };
}

module.exports = { espionarComSelenium, comSelenium, lerConfig, pythonDoPc, ARQ_CONFIG };
