'use strict';
// Player do PC: o mpv toca o vídeo (HEVC/4K, MKV, Dolby, HDR) que o navegador
// não toca. O app conversa com ele por um "cano" local (IPC) para saber a
// posição, a resolução e quando o vídeo terminou ou foi fechado.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const WINDOWS = process.platform === 'win32';
const PASTA_MPV = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ConectaTV', 'mpv');

function acharMpv({ env = process.env, existe = arq => { try { return fs.statSync(arq).isFile(); } catch { return false; } } } = {}) {
    const nome = WINDOWS ? 'mpv.exe' : 'mpv';
    // O instalador grava onde o mpv ficou (winget ou pasta própria).
    let gravado = '';
    try { gravado = fs.readFileSync(path.join(path.dirname(PASTA_MPV), 'mpv-caminho.txt'), 'utf8').replace(/^\uFEFF/, '').trim(); } catch { /* ainda não instalado */ }
    const candidatos = [env.CONECTA_MPV, gravado, path.join(PASTA_MPV, nome)];
    for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) if (dir) candidatos.push(path.join(dir, nome));
    return candidatos.find(c => c && existe(c)) || '';
}

function enderecoIpc(sessao) {
    return WINDOWS ? `\\\\.\\pipe\\conectatv-${sessao}` : path.join(os.tmpdir(), `conectatv-${sessao}.sock`);
}

// Só endereços http(s) sem usuário/senha. Texto livre vira só caracteres seguros.
function urlSegura(bruto) {
    try {
        const u = new URL(String(bruto || ''));
        if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
        return u.href;
    } catch { return ''; }
}
function textoSeguro(s, max = 120) { return String(s || '').replace(/[\x00-\x1f\x7f"]/g, ' ').trim().slice(0, max); }

function argumentos({ url, titulo, posicao, referer, ipc }) {
    const args = [
        `--input-ipc-server=${ipc}`,
        '--fs', '--force-window=immediate', '--keep-open=no', '--idle=no',
        '--hwdec=auto-safe',
        '--alang=pt-BR,pt,por,pob,ptbr,portuguese',
        '--slang=pt-BR,pt,por,pob,ptbr',
        '--cache=yes', '--demuxer-max-bytes=512MiB', '--demuxer-readahead-secs=60',
        '--network-timeout=30', '--ytdl=no', '--osd-level=1',
        '--screenshot-directory=~~desktop/',
        `--force-media-title=${textoSeguro(titulo) || 'Conecta TV'}`,
        `--title=${textoSeguro(titulo) || 'Conecta TV'} · Conecta TV`,
    ];
    const conf = path.join(path.dirname(PASTA_MPV), 'mpv-config');
    try { if (fs.statSync(conf).isDirectory()) args.push(`--config-dir=${conf}`); } catch { /* sem configuração própria */ }
    if (Number(posicao) > 5) args.push(`--start=${Math.floor(Number(posicao))}`);
    const ref = urlSegura(referer);
    if (ref) args.push(`--referrer=${ref}`);
    args.push('--', url);
    return args;
}

function criarPlayer({ executar = spawn, conectar = net.connect, acharExe = acharMpv } = {}) {
    const avisos = new EventEmitter();
    avisos.setMaxListeners(50);
    let atual = null;
    const vazio = () => ({ sessao: '', tocando: false, imagem: false, posicao: 0, duracao: 0, pausado: false, altura: 0, terminou: false, motivo: '', erro: '' });
    let estado = vazio();
    const mudou = () => avisos.emit('mudou', { ...estado });

    function parar() {
        const a = atual;
        if (!a) return;
        try { a.enviar({ command: ['quit'] }); } catch { /* cano já fechado */ }
        setTimeout(() => { try { if (a.filho.exitCode === null) a.filho.kill(); } catch { /* já saiu */ } }, 1500);
    }

    function tocar({ url, titulo, posicao, referer }) {
        const exe = acharExe();
        if (!exe) return { erro: 'o player do PC ainda não está instalado' };
        const endereco = urlSegura(url);
        if (!endereco) return { erro: 'endereço de vídeo inválido' };
        parar();
        const sessao = crypto.randomBytes(8).toString('hex');
        const ipc = enderecoIpc(sessao);
        let filho;
        try { filho = executar(exe, argumentos({ url: endereco, titulo, posicao, referer, ipc }), { stdio: 'ignore', windowsHide: false }); }
        catch (e) { return { erro: 'não consegui abrir o player: ' + e.message }; }
        estado = { ...vazio(), sessao, tocando: true, posicao: Number(posicao) || 0 };
        const sessaoAtual = { sessao, filho, sock: null, fim: '', enviar: () => {} };
        atual = sessaoAtual;
        const eu = () => atual === sessaoAtual;
        const conferirImagem = () => {
            if (!estado.imagem && estado.altura > 0 && estado.posicao > 0.3) { estado.imagem = true; mudou(); }
        };
        let resto = '';
        const ligar = (tentativa = 0) => {
            if (!eu() || filho.exitCode !== null) return;
            const sock = conectar(ipc);
            sock.on('connect', () => {
                sessaoAtual.sock = sock;
                sessaoAtual.enviar = obj => sock.write(JSON.stringify(obj) + '\n');
                [['time-pos', 1], ['duration', 2], ['pause', 3], ['height', 4]].forEach(([nome, id]) => sessaoAtual.enviar({ command: ['observe_property', id, nome] }));
            });
            sock.on('data', dado => {
                resto += dado.toString('utf8');
                const linhas = resto.split('\n'); resto = linhas.pop();
                for (const linha of linhas) {
                    let m; try { m = JSON.parse(linha); } catch { continue; }
                    if (!eu()) return;
                    if (m.event === 'property-change') {
                        if (m.name === 'time-pos' && Number.isFinite(m.data)) { const antes = Math.floor(estado.posicao / 5); estado.posicao = m.data; conferirImagem(); if (Math.floor(m.data / 5) !== antes) mudou(); }
                        else if (m.name === 'duration' && Number.isFinite(m.data)) estado.duracao = m.data;
                        else if (m.name === 'pause') { estado.pausado = Boolean(m.data); mudou(); }
                        else if (m.name === 'height' && Number.isFinite(m.data)) { estado.altura = m.data; conferirImagem(); }
                    } else if (m.event === 'end-file') {
                        sessaoAtual.fim = String(m.reason || '');
                        if (m.reason === 'error') estado.erro = String(m.file_error || 'erro ao abrir o vídeo');
                    }
                }
            });
            sock.on('error', () => { if (!sessaoAtual.sock && tentativa < 60) setTimeout(() => ligar(tentativa + 1), 250); });
        };
        setTimeout(() => ligar(0), 200);
        filho.on('error', e => { if (eu()) { estado.erro = e.message; } });
        filho.on('exit', codigo => {
            if (!eu()) return;
            try { sessaoAtual.sock && sessaoAtual.sock.destroy(); } catch { /* já fechado */ }
            atual = null;
            estado.tocando = false; estado.terminou = true;
            estado.motivo = sessaoAtual.fim || (codigo === 0 ? 'quit' : 'error');
            if (estado.motivo === 'error' && !estado.erro) estado.erro = 'o player fechou com erro';
            mudou();
        });
        mudou();
        return { ok: true, sessao };
    }

    // Espera uma mudança (ou até `ms`) — o navegador fica ligado a isto em vez
    // de perguntar a cada segundo (a janela coberta pelo player é "dormida").
    function esperar(ms = 20000) {
        return new Promise(ok => {
            const fim = () => { clearTimeout(t); avisos.off('mudou', fim); ok({ ...estado }); };
            const t = setTimeout(fim, ms);
            avisos.on('mudou', fim);
        });
    }

    return { tocar, parar, esperar, estado: () => ({ ...estado }), ocupado: () => Boolean(atual) };
}

module.exports = { criarPlayer, acharMpv, argumentos, urlSegura, enderecoIpc, PASTA_MPV };
