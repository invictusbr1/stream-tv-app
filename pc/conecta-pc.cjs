'use strict';
// Conecta TV para PC (Windows).
//
// Abre o mesmo Conecta TV numa janela própria e toca os vídeos no player do
// Windows (mpv): 4K/HEVC, MKV e som Dolby, que o navegador não toca. O
// servidor roda NESTE computador (internet de casa), então as fontes que
// bloqueiam servidores de nuvem também funcionam aqui.
//
// Abrir de novo com o app já aberto só traz a janela de volta. Fechada a
// janela (e sem vídeo tocando), o programa sai sozinho depois de 2 minutos.

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..');
const WINDOWS = process.platform === 'win32';
const ARQ_INSTANCIA = path.join(os.homedir(), '.streamtv', 'conecta-pc.json');
const PORTA_PREFERIDA = 3480;

// Sem janela de terminal: o que o servidor escreve vai para um arquivo
// (%USERPROFILE%\.streamtv\conecta-pc.log, recomeça ao passar de 2 MB).
if (WINDOWS && !process.stdout.isTTY) {
    const log = path.join(os.homedir(), '.streamtv', 'conecta-pc.log');
    try { fs.mkdirSync(path.dirname(log), { recursive: true }); if (fs.statSync(log).size > 2e6) fs.writeFileSync(log, ''); } catch { /* novo */ }
    const gravar = (...a) => { try { fs.appendFileSync(log, `[${new Date().toLocaleTimeString('pt-BR')}] ${a.map(String).join(' ')}\n`); } catch { /* disco cheio */ } };
    console.log = gravar; console.error = gravar; console.warn = gravar;
}
const OCIOSO_MS = 2 * 60 * 1000;

function ping(porta, chave) {
    return new Promise(ok => {
        const req = http.get({ host: '127.0.0.1', port: porta, path: '/api/pc/estado', headers: { 'x-conecta-pc': chave }, timeout: 2000 }, res => { res.resume(); ok(res.statusCode === 200); });
        req.on('error', () => ok(false));
        req.on('timeout', () => { req.destroy(); ok(false); });
    });
}

function portaAberta(porta) {
    return new Promise(ok => {
        const s = net.connect(porta, '127.0.0.1');
        s.once('connect', () => { s.destroy(); ok(true); });
        s.once('error', () => ok(false));
    });
}

function acharNavegador() {
    const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const candidatos = [];
    for (const b of bases) candidatos.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const b of bases) candidatos.push(path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return candidatos.find(c => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || '';
}

function abrirJanela(url) {
    if (!WINDOWS || process.env.CONECTA_PC_SEM_JANELA) { console.log('Conecta TV PC em ' + url); return; }
    const nav = acharNavegador();
    const filho = nav
        ? spawn(nav, ['--app=' + url, '--start-maximized', '--no-first-run', '--autoplay-policy=no-user-gesture-required'], { detached: true, stdio: 'ignore' })
        : spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true });
    filho.on('error', () => {});
    filho.unref();
}

// Atalho "Conecta TV (PC)" na Área de Trabalho, uma vez. Comando em UTF-16
// para não estragar o "Á" de "Área de Trabalho".
function criarAtalho() {
    if (!WINDOWS) return;
    const vbs = path.join(RAIZ, 'Conecta TV PC.vbs');
    const q = s => s.replace(/'/g, "''");
    const icone = path.join(RAIZ, 'pc', 'conecta.ico');
    const script = [
        "$d=[Environment]::GetFolderPath('Desktop')",
        "$l=Join-Path $d 'Conecta TV (PC).lnk'",
        'if (Test-Path -LiteralPath $l) { return }',
        '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($l)',
        "$s.TargetPath=(Join-Path $env:WINDIR 'System32\\wscript.exe')",
        `$s.Arguments='"${q(vbs)}"'`,
        `$s.WorkingDirectory='${q(RAIZ)}'`,
        "$s.Description='Conecta TV no computador (4K)'",
        `$i='${q(icone)}'; if (Test-Path -LiteralPath $i) { $s.IconLocation=$i }`,
        '$s.Save()',
    ].join('; ');
    const filho = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true, detached: true });
    filho.on('error', () => {});
    filho.unref();
}

// "Versão" do programa do PC: muda quando estes arquivos mudam. Um app antigo
// ainda aberto é fechado para a versão nova assumir.
function versaoDoCodigo() {
    const h = crypto.createHash('sha1');
    for (const arq of ['pc/conecta-pc.cjs', 'pc/mpv.cjs', 'pc/instalador.cjs', 'pc/instalar-mpv.ps1', 'rotas/pc.js', 'rotas/playback.js', 'server.js']) {
        try { h.update(fs.readFileSync(path.join(RAIZ, arq))); } catch { /* arquivo ausente */ }
    }
    return h.digest('hex').slice(0, 16);
}

async function principal() {
    const versao = versaoDoCodigo();
    try {
        const ant = JSON.parse(fs.readFileSync(ARQ_INSTANCIA, 'utf8'));
        if (ant.porta && ant.chave && await ping(ant.porta, ant.chave)) {
            if (ant.versao === versao) { abrirJanela(`http://127.0.0.1:${ant.porta}/?pc=${ant.chave}`); return; }
            try { process.kill(Number(ant.pid)); } catch { /* já tinha saído */ }
            for (let i = 0; i < 20 && await ping(ant.porta, ant.chave); i++) await new Promise(r => setTimeout(r, 250));
        }
    } catch { /* primeira abertura */ }

    const chave = crypto.randomBytes(24).toString('hex');
    process.env.CONECTA_PC = '1';
    process.env.CONECTA_PC_TOKEN = chave;
    if (!process.env.PORT) process.env.PORT = String(PORTA_PREFERIDA);
    process.chdir(RAIZ);
    require(path.join(RAIZ, 'server.js'));

    // Espera o servidor escolher a porta e começar a atender.
    let porta = 0;
    for (let i = 0; i < 120 && !porta; i++) {
        await new Promise(r => setTimeout(r, 250));
        const p = Number(process.env.CONECTA_PORTA);
        if (p && await portaAberta(p)) porta = p;
    }
    if (!porta) throw new Error('o servidor não abriu');
    fs.mkdirSync(path.dirname(ARQ_INSTANCIA), { recursive: true });
    fs.writeFileSync(ARQ_INSTANCIA, JSON.stringify({ porta, chave, pid: process.pid, versao }));
    const sair = () => {
        try { const a = JSON.parse(fs.readFileSync(ARQ_INSTANCIA, 'utf8')); if (a.chave === chave) fs.unlinkSync(ARQ_INSTANCIA); } catch { /* já saiu */ }
        try { require(path.join(RAIZ, 'rotas', 'pc.js')).ultimo?.playerPc?.parar(); } catch { /* sem player */ }
        setTimeout(() => process.exit(0), 300);
    };
    abrirJanela(`http://127.0.0.1:${porta}/?pc=${chave}`);
    criarAtalho();
    setInterval(() => {
        const pc = require(path.join(RAIZ, 'rotas', 'pc.js')).ultimo;
        if (pc && pc.ociosoHa() > OCIOSO_MS) sair();
    }, 15000).unref();
    process.on('SIGINT', sair);
    process.on('SIGTERM', sair);
}

if (require.main === module) principal().catch(e => {
    try { fs.mkdirSync(path.join(os.homedir(), '.streamtv'), { recursive: true }); fs.appendFileSync(path.join(os.homedir(), '.streamtv', 'conecta-pc.log'), new Date().toISOString() + ' ' + e.stack + '\n'); } catch { /* sem log */ }
    console.error('Conecta TV PC: ' + e.message);
    process.exitCode = 1;
});
module.exports = { abrirJanela, acharNavegador };
