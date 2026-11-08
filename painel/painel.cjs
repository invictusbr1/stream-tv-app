'use strict';
// Painel do Conecta TV: uma janelinha com botões para as tarefas do dia a dia
// (atualizar o servidor, publicar o app, ligar o caçador, verificar links…).
//
// Roda só neste PC: escuta em 127.0.0.1, exige uma chave sorteada a cada
// abertura e confere o Host de cada pedido. Os botões chamam os mesmos
// atalhos .cmd/.ps1 da pasta, então nada muda no jeito que eles funcionam.
// Abrir de novo com o painel já aberto só traz a janela de volta.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..');
const PASTA_PC = path.join(os.homedir(), '.streamtv');
const ARQ_INSTANCIA = path.join(PASTA_PC, 'painel.json');
const PORTA_PREFERIDA = 4180;
const WINDOWS = process.platform === 'win32';
const OCIOSO_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Ações dos botões

const ACOES = {
    'oracle-atualizar': { grupo: 'oracle', titulo: 'Atualizar servidor (Oracle)', cmd: 'Atualizar-Oracle-Agora.cmd' },
    'oracle-diagnostico': { grupo: 'oracle-status', titulo: 'Diagnóstico do servidor (disco, 4K, conversões)', node: ['deploy/servidor/diagnostico-servidor.cjs'] },
    'oracle-espaco': { grupo: 'oracle-status', titulo: 'Liberar espaço no servidor', node: ['deploy/servidor/liberar-espaco-servidor.cjs'] },
    'oracle-status': { grupo: 'oracle-status', titulo: 'Estado do servidor', node: ['deploy/servidor/publicar-automatico.cjs', '--status'] },
    'oracle-recarregar': { grupo: 'oracle', titulo: 'Recarregar fontes na Oracle', cmd: 'Recarregar-Fontes-Oracle.cmd' },
    'app-publicar': { grupo: 'app', titulo: 'Publicar app (canal de teste)', cmd: 'Publicar-Agora.cmd', acompanhar: 'publicacao.log' },
    'app-liberar': { grupo: 'app', titulo: 'Liberar para a família', ps: 'Liberar-Para-Todos.ps1' },
    'cacador-ligar': { grupo: 'cacador', titulo: 'Caçador contínuo', cmd: 'Cacador-PC.cmd', continuo: true },
    'cacador-rodada': { grupo: 'cacador', titulo: 'Caçador: uma rodada', cmd: 'Cacador-PC.cmd', args: ['--uma-vez'] },
    'cacador-novelas': { grupo: 'cacador', titulo: 'Caçador: rodada de novelas', cmd: 'Cacador-PC.cmd', args: ['--uma-vez', '--novelas'] },
    'cacador-links': { grupo: 'cacador', titulo: 'Verificar links', cmd: 'Cacador-PC.cmd' },
    'cacador-explorar': { grupo: 'cacador', titulo: 'Caçar fontes novas agora (inclui torrent para a TorBox)', cmd: 'Cacador-PC.cmd', args: ['--explorar'] },
    'cacador-investigar': { grupo: 'cacador', titulo: 'Investigar fontes que caíram', cmd: 'Cacador-PC.cmd', args: ['--investigar'] },
    'cacador-publicar': { grupo: 'cacador', titulo: 'Publicar fichas (aplicar fontes ligadas/desligadas)', cmd: 'Cacador-PC.cmd', args: ['--publicar'] },
    'cacador-descobertas': { grupo: 'cacador-relatorio', titulo: 'Descobertas da semana', node: ['central/cacador-pc.cjs', '--descobertas'] },
    'torbox-testar': { grupo: 'cacador-relatorio', titulo: 'Testar TorBox (não gasta downloads)', node: ['central/testar-torbox.cjs'] },
    'torbox-tocar': { grupo: 'cacador-relatorio', titulo: 'TorBox: tocar 3 de verdade (gasta 3 downloads)', node: ['central/testar-torbox.cjs', '--tocar'] },
    'addons-testar': { grupo: 'cacador-relatorio', titulo: 'Conferir lista fixa de addons (manual)', node: ['central/testar-addons.cjs'] },
    'torbox-link': { grupo: 'cacador-relatorio', titulo: 'TorBox: examinar o link (gasta 1 download)', node: ['central/testar-torbox.cjs', '--link'] },
    'torbox-slots': { grupo: 'cacador-relatorio', titulo: 'TorBox: testar slots (gasta 1 download, ~1 min)', node: ['central/testar-torbox.cjs', '--slots'] },
    'torbox-procurar': { grupo: 'cacador-relatorio', titulo: 'TorBox: procurar Curvas da Vida (não gasta downloads)', node: ['central/testar-torbox.cjs', '--procurar', 'tt2083383'] },
    'cacador-anime': { grupo: 'cacador', titulo: 'Caçar fontes de ANIME (legendado e dublado)', cmd: 'Cacador-PC.cmd', args: ['--anime'] },
    'torbox-anime': { grupo: 'cacador-relatorio', titulo: 'TorBox: testar anime legendado', node: ['central/testar-torbox.cjs', '--anime'] },
    'torbox-fonte': { grupo: 'cacador-relatorio', titulo: 'TorBox: testar a fonte do app', node: ['central/testar-torbox.cjs', '--fonte'] },
    'torbox-chave-servidor': { grupo: 'cacador-relatorio', titulo: 'TorBox: enviar chave ao servidor', node: ['deploy/servidor/enviar-chave-torbox.cjs'] },
    'central-erros': { grupo: 'central-erros', titulo: 'Erros recentes da Central', cmd: 'Cacador-PC.cmd', args: ['--erros'] },
    'central-abrir': { grupo: 'central', titulo: 'Abrir a Central', ps: 'Abrir-Central.ps1' },
    'samsung-diagnostico': { grupo: 'samsung', titulo: 'Diagnóstico da TV Samsung', ps: 'samsung/Diagnostico-Rede-Samsung.ps1' },
};

// Links colados: um por linha, só http(s) ou stremio://, no máximo 30.
function limparLinks(texto) {
    const vistos = new Set();
    for (const bruto of String(texto || '').split(/[\s,;]+/)) {
        let l = bruto.trim().replace(/[)\].,'"]+$/, '');
        // Endereço sem "https://" (ex.: site.com.br ou www.site.com/filme): completa.
        if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(l)) l = 'https://' + l;
        if (!/^(https?|stremio):\/\/[^\s]+$/i.test(l) || l.length > 500) continue;
        vistos.add(l);
        if (vistos.size >= 30) break;
    }
    return [...vistos];
}

function ipValido(ip) {
    const s = String(ip || '').trim();
    return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every(n => Number(n) <= 255) ? s : '';
}

// Monta o comando de uma ação: devolve { exe, args, opcoes } ou { erro }.
function montarComando(nome, extra = {}, { raiz = RAIZ, windows = WINDOWS, pastaDados = path.join(RAIZ, 'central', 'dados-pc') } = {}) {
    const acao = ACOES[nome];
    if (!acao) return { erro: 'ação desconhecida' };
    let args = [...(acao.args || [])];
    const juntar = windows ? path.win32.join : path.join;
    let psParams = '';
    if (nome === 'cacador-links') {
        const links = limparLinks(extra.links);
        if (!links.length) return { erro: 'cole pelo menos um link (https://…)' };
        fs.mkdirSync(pastaDados, { recursive: true });
        const arq = path.join(pastaDados, 'links-do-painel.txt');
        fs.writeFileSync(arq, links.join('\n') + '\n', 'utf8');
        args = ['--paginas', arq];
    }
    if (nome === 'central-erros' && extra.filtro) {
        const filtro = String(extra.filtro).trim().slice(0, 60);
        if (!/^[\p{L}\p{N} .:-]+$/u.test(filtro)) return { erro: 'use só o nome do título (letras e números)' };
        args = ['--erros', filtro];
    }
    if (nome === 'cacador-investigar' && extra.alvo) {
        // Nome ou endereço antigo: só letras, números e . : / - _ (vai na linha de comando).
        const alvo = String(extra.alvo).trim().slice(0, 120);
        if (!/^[\p{L}\p{N} .:/_-]+$/u.test(alvo)) return { erro: 'use só o nome ou o endereço antigo da fonte (letras, números, . / : -)' };
        args = ['--investigar', alvo];
    }
    if (nome === 'samsung-diagnostico') {
        const ip = ipValido(extra.ip);
        if (!ip) return { erro: 'digite o IP da TV (ex.: 192.168.1.7)' };
        psParams = ` -IpDaTv '${ip}'`;
    }
    const opcoes = { cwd: raiz, env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' } };
    if (acao.node) return { exe: process.execPath, args: [...acao.node.map((a, i) => i === 0 ? juntar(raiz, a) : a), ...args], opcoes };
    if (acao.cmd) {
        const alvo = juntar(raiz, acao.cmd);
        if (!windows) return { exe: 'sh', args: ['-c', `echo "(só no Windows) ${acao.cmd} ${args.join(' ')}"`], opcoes };
        const linha = `chcp 65001 >nul & "${alvo}"${args.map(a => ` "${a}"`).join('')}`;
        return { exe: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${linha}"`], opcoes: { ...opcoes, windowsVerbatimArguments: true } };
    }
    if (acao.ps) {
        const alvo = juntar(raiz, acao.ps).replace(/'/g, "''");
        const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; & '${alvo}'${psParams}`;
        if (!windows) return { exe: 'sh', args: ['-c', `echo "(só no Windows) ${acao.ps}${psParams}"`], opcoes };
        return { exe: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], opcoes };
    }
    return { erro: 'ação sem comando' };
}

// ---------------------------------------------------------------------------
// Tarefas em andamento

const tarefas = [];
let proximoId = 1;

function limparLinha(s) {
    // Tira cores do terminal e caracteres de controle.
    return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\s+$/, '');
}

function anotar(tarefa, texto) {
    for (const linha of String(texto).split(/\r?\n|\r/)) {
        const l = limparLinha(linha);
        if (!l) continue;
        if (l.startsWith('RESULTADO:')) { try { tarefa.resultado = JSON.parse(l.slice(10)); } catch { /* linha cortada */ } continue; }
        tarefa.linhas.push(l);
        if (tarefa.linhas.length > 4000) { tarefa.linhas.splice(0, 1000); tarefa.base += 1000; }
    }
}

function emAndamento(grupo) { return tarefas.find(t => t.grupo === grupo && t.fim === null); }

function iniciar(nome, extra = {}, executar = spawn) {
    const acao = ACOES[nome];
    if (!acao) return { erro: 'ação desconhecida' };
    const ocupada = emAndamento(acao.grupo);
    if (ocupada) return { erro: `"${ocupada.titulo}" ainda está rodando. Espere terminar${ocupada.continuo ? ' ou clique em Parar' : ''}.` };
    const c = montarComando(nome, extra);
    if (c.erro) return c;
    const tarefa = { id: proximoId++, acao: nome, grupo: acao.grupo, titulo: acao.titulo, continuo: Boolean(acao.continuo), inicio: Date.now(), fim: null, codigo: null, linhas: [], base: 0, resultado: null, pid: null };
    tarefas.push(tarefa);
    while (tarefas.length > 40) { const i = tarefas.findIndex(t => t.fim !== null); if (i < 0) break; tarefas.splice(i, 1); }
    let filho;
    try { filho = executar(c.exe, c.args, { ...c.opcoes, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { anotar(tarefa, 'não consegui iniciar: ' + e.message); tarefa.fim = Date.now(); tarefa.codigo = -1; return { id: tarefa.id }; }
    tarefa.pid = filho.pid;
    tarefa.filho = filho;
    const resto = { out: '', err: '' };
    const ler = chave => dado => {
        resto[chave] += dado.toString('utf8');
        const partes = resto[chave].split(/\r?\n/);
        resto[chave] = partes.pop();
        anotar(tarefa, partes.join('\n'));
    };
    filho.stdout && filho.stdout.on('data', ler('out'));
    filho.stderr && filho.stderr.on('data', ler('err'));
    // Publicar-Agora grava o passo a passo num arquivo de registro: mostra ao vivo.
    let vigia = null;
    if (acao.acompanhar) {
        const arq = path.join(RAIZ, acao.acompanhar);
        let lido = 0;
        try { lido = fs.statSync(arq).size; } catch { /* ainda não existe */ }
        vigia = setInterval(() => {
            try {
                const tam = fs.statSync(arq).size;
                if (tam < lido) lido = 0;
                if (tam === lido) return;
                const fd = fs.openSync(arq, 'r'); const buf = Buffer.alloc(Math.min(tam - lido, 512 * 1024));
                fs.readSync(fd, buf, 0, buf.length, lido); fs.closeSync(fd); lido += buf.length;
                anotar(tarefa, buf.toString('utf8').split(/\r?\n/).map(l => l && '  │ ' + l).join('\n'));
            } catch { /* arquivo ocupado */ }
        }, 1500);
    }
    const terminar = codigo => {
        if (tarefa.fim !== null) return;
        if (vigia) clearInterval(vigia);
        anotar(tarefa, resto.out + '\n' + resto.err);
        tarefa.fim = Date.now(); tarefa.codigo = codigo; delete tarefa.filho;
        anotar(tarefa, tarefa.parada ? '— parado por você —' : codigo === 0 ? '— concluído —' : `— terminou com erro (código ${codigo}) —`);
    };
    filho.on('error', e => { anotar(tarefa, 'erro: ' + e.message); terminar(-1); });
    filho.on('close', codigo => terminar(codigo == null ? -1 : codigo));
    // Se algum programa filho ficar segurando a saída (ex.: Gradle), não espera para sempre.
    filho.on('exit', codigo => setTimeout(() => terminar(codigo == null ? -1 : codigo), 3000));
    return { id: tarefa.id };
}

function parar(id) {
    const t = tarefas.find(x => x.id === Number(id));
    if (!t || t.fim !== null) return { erro: 'essa tarefa já terminou' };
    t.parada = true;
    if (WINDOWS && t.pid) spawnSync('taskkill', ['/PID', String(t.pid), '/T', '/F'], { windowsHide: true });
    // Também avisa o processo direto (no Windows o taskkill já encerrou; não faz mal).
    try { if (t.filho) t.filho.kill('SIGTERM'); } catch { /* já saiu */ }
    return { ok: true };
}

function resumoDasTarefas() {
    return tarefas.map(t => ({ id: t.id, acao: t.acao, titulo: t.titulo, continuo: t.continuo, inicio: t.inicio, fim: t.fim, codigo: t.codigo, parada: Boolean(t.parada), total: t.base + t.linhas.length, temResultado: Boolean(t.resultado) }));
}

// ---------------------------------------------------------------------------
// Servidor local

// Fontes aprovadas pelo caçador nos últimos 7 dias (destaque no topo do painel).
function aprovadasRecentes(arquivo = path.join(RAIZ, 'central', 'dados-pc', 'aprovadas.jsonl'), agora = Date.now()) {
    try {
        return fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(a => a && agora - Date.parse(a.em) < 7 * 864e5).slice(-5).reverse();
    } catch { return []; }
}

function versaoDaPasta() {
    try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version; } catch { return '?'; }
}

function lerCorpo(req) {
    return new Promise((ok, falha) => {
        let s = '';
        req.on('data', d => { s += d; if (s.length > 200000) { falha(new Error('grande demais')); req.destroy(); } });
        req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { falha(e); } });
        req.on('error', falha);
    });
}

function criarServidor({ token, aoMexer = () => {}, aoSair = () => {} }) {
    const html = () => fs.readFileSync(path.join(__dirname, 'painel.html'), 'utf8');
    const servidor = http.createServer(async (req, res) => {
        const porta = servidor.address().port;
        const responder = (codigo, corpo, tipo = 'application/json; charset=utf-8') => {
            res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
            res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
        };
        // Só aceita quem chama este PC pelo endereço exato (bloqueia DNS rebinding).
        if (req.headers.host !== `127.0.0.1:${porta}`) return responder(403, { erro: 'endereço não permitido' });
        const url = new URL(req.url, `http://127.0.0.1:${porta}`);
        if (req.method === 'GET' && url.pathname === '/') {
            if (url.searchParams.get('t') !== token) return responder(403, '<meta charset="utf-8"><p style="font:16px sans-serif;padding:24px">Abra o painel pelo atalho <b>Painel Conecta TV</b>.</p>', 'text/html; charset=utf-8');
            aoMexer();
            return responder(200, html(), 'text/html; charset=utf-8');
        }
        if (!url.pathname.startsWith('/api/')) return responder(404, { erro: 'não encontrado' });
        if (req.headers['x-painel'] !== token) return responder(403, { erro: 'chave inválida' });
        const origem = req.headers.origin;
        if (req.method === 'POST' && origem && origem !== `http://127.0.0.1:${porta}`) return responder(403, { erro: 'origem não permitida' });
        aoMexer();
        try {
            if (req.method === 'GET' && url.pathname === '/api/ping') return responder(200, { ok: true });
            if (req.method === 'GET' && url.pathname === '/api/estado') return responder(200, { versao: versaoDaPasta(), tarefas: resumoDasTarefas(), aprovadas: aprovadasRecentes() });
            if (req.method === 'GET' && url.pathname === '/api/tarefa') {
                const t = tarefas.find(x => x.id === Number(url.searchParams.get('id')));
                if (!t) return responder(404, { erro: 'tarefa não encontrada' });
                const desde = Math.max(Number(url.searchParams.get('desde')) || 0, t.base);
                return responder(200, { id: t.id, fim: t.fim, codigo: t.codigo, total: t.base + t.linhas.length, linhas: t.linhas.slice(desde - t.base), resultado: t.resultado });
            }
            if (req.method === 'POST' && url.pathname === '/api/acao') {
                const corpo = await lerCorpo(req);
                const r = iniciar(String(corpo.acao || ''), corpo);
                return responder(r.erro ? 400 : 200, r);
            }
            if (req.method === 'POST' && url.pathname === '/api/parar') { const corpo = await lerCorpo(req); const r = parar(corpo.id); return responder(r.erro ? 400 : 200, r); }
            if (req.method === 'POST' && url.pathname === '/api/sair') { responder(200, { ok: true }); setTimeout(aoSair, 200); return; }
            return responder(404, { erro: 'não encontrado' });
        } catch (e) { return responder(400, { erro: String(e.message || e) }); }
    });
    return servidor;
}

// ---------------------------------------------------------------------------
// Janela e atalho

function acharNavegador() {
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const candidatos = [];
    for (const base of pf) candidatos.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const base of pf) candidatos.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return candidatos.find(c => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || '';
}

function abrirJanela(url) {
    if (!WINDOWS || process.env.PAINEL_SEM_JANELA) { console.log('Painel em ' + url); return; }
    const nav = acharNavegador();
    const filho = nav
        ? spawn(nav, ['--app=' + url, '--window-size=1220,880', '--no-first-run'], { detached: true, stdio: 'ignore' })
        : spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true });
    filho.on('error', () => {});
    filho.unref();
}

// Cria "Painel Conecta TV" na Área de Trabalho (uma vez). O comando vai em
// UTF-16 (-EncodedCommand) para não estragar o "Á" de "Área de Trabalho".
function criarAtalho() {
    if (!WINDOWS) return;
    const vbs = path.join(RAIZ, 'Painel Conecta TV.vbs');
    const q = s => s.replace(/'/g, "''");
    const script = [
        "$d=[Environment]::GetFolderPath('Desktop')",
        "$l=Join-Path $d 'Painel Conecta TV.lnk'",
        'if (Test-Path -LiteralPath $l) { return }',
        '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($l)',
        "$s.TargetPath=(Join-Path $env:WINDIR 'System32\\wscript.exe')",
        `$s.Arguments='"${q(vbs)}"'`,
        `$s.WorkingDirectory='${q(RAIZ)}'`,
        "$s.Description='Painel do Conecta TV'",
        "$s.IconLocation=(Join-Path $env:WINDIR 'System32\\shell32.dll')+',238'",
        '$s.Save()',
    ].join('; ');
    const filho = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true, detached: true });
    filho.on('error', () => {});
    filho.unref();
}

// ---------------------------------------------------------------------------
// Início

function pedir(porta, token, caminho) {
    return new Promise(ok => {
        const req = http.get({ host: '127.0.0.1', port: porta, path: caminho, headers: { 'x-painel': token }, timeout: 1500 }, res => { res.resume(); ok(res.statusCode === 200); });
        req.on('error', () => ok(false));
        req.on('timeout', () => { req.destroy(); ok(false); });
    });
}

function escutar(servidor, porta) {
    return new Promise((ok, falha) => {
        servidor.once('error', falha);
        servidor.listen(porta, '127.0.0.1', () => { servidor.off('error', falha); ok(servidor.address().port); });
    });
}

async function principal() {
    // Já tem um painel aberto? Só mostra a janela de novo.
    try {
        const ant = JSON.parse(fs.readFileSync(ARQ_INSTANCIA, 'utf8'));
        if (ant.porta && ant.token && await pedir(ant.porta, ant.token, '/api/ping')) { abrirJanela(`http://127.0.0.1:${ant.porta}/?t=${ant.token}`); return; }
    } catch { /* primeira vez */ }

    const token = crypto.randomBytes(24).toString('hex');
    let ultimoUso = Date.now();
    let servidor;
    const sair = () => { try { const a = JSON.parse(fs.readFileSync(ARQ_INSTANCIA, 'utf8')); if (a.token === token) fs.unlinkSync(ARQ_INSTANCIA); } catch { /* já saiu */ } process.exit(0); };
    // "Fechar painel" para tudo o que estiver rodando (inclusive o caçador).
    const fechar = () => { for (const t of tarefas) if (t.fim === null) parar(t.id); setTimeout(sair, 500); };
    const montar = () => criarServidor({ token, aoMexer: () => { ultimoUso = Date.now(); }, aoSair: fechar });
    servidor = montar();
    let porta;
    try { porta = await escutar(servidor, PORTA_PREFERIDA); }
    catch { servidor = montar(); porta = await escutar(servidor, 0); }
    fs.mkdirSync(PASTA_PC, { recursive: true });
    fs.writeFileSync(ARQ_INSTANCIA, JSON.stringify({ porta, token, pid: process.pid }));
    abrirJanela(`http://127.0.0.1:${porta}/?t=${token}`);
    criarAtalho();
    // Janela fechada e nada rodando há 2 minutos: o painel fecha sozinho.
    // (Com o caçador contínuo ligado, o painel fica aberto escondido para ele.)
    setInterval(() => {
        if (tarefas.some(t => t.fim === null)) return;
        if (Date.now() - ultimoUso > OCIOSO_MS) sair();
    }, 15000).unref();
    process.on('SIGINT', sair);
}

if (require.main === module) principal().catch(e => { console.error('painel: ' + e.message); process.exitCode = 1; });
module.exports = { aprovadasRecentes, ACOES, limparLinks, ipValido, montarComando, criarServidor, iniciar, parar, tarefas, anotar };
