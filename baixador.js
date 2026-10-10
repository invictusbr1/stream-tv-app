'use strict';
// Baixador do Conecta TV — grava o episódio (ou o filme) de verdade no
// computador, a partir da mesma fonte dublada e sem anúncio que o player usa.
//
// O arquivo sai em %USERPROFILE%\Downloads\Conecta TV como MP4, copiando o
// vídeo e o áudio originais (sem perder qualidade e sem demorar como uma
// conversão). O ffmpeg é o mesmo que a central já usa.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PASTA = path.join(os.homedir(), 'Downloads', 'Conecta TV');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const trabalhos = new Map();

function nomeArquivo(rotulo) {
    const limpo = String(rotulo || 'video')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 90);
    return (limpo || 'video') + '.mp4';
}

async function ffmpegPath() {
    const central = require('./central/verificar-midia');
    const ferramentas = await central.garantirFerramentas(() => { /* silencioso */ });
    return ferramentas.ffmpeg;
}

async function duracaoDe(url, referer) {
    try {
        const central = require('./central/verificar-midia');
        const faixas = await central.faixasDeAudio(url, referer);
        return Number(faixas && faixas.duracao) || 0;
    } catch { return 0; }
}

// Começa (ou reaproveita) o download de um endereço já resolvido.
async function iniciar(url, { rotulo = '', referer = '', id = '' } = {}) {
    const chave = String(id || rotulo || Date.now()).replace(/[^\w-]+/g, '-').slice(0, 60);
    const existente = trabalhos.get(chave);
    if (existente && !existente.terminou) return resumo(chave);
    if (existente && existente.arquivo && fs.existsSync(existente.arquivo) && !existente.erro) return resumo(chave);

    try { fs.mkdirSync(PASTA, { recursive: true }); } catch { /* sem permissão */ }
    const arquivo = path.join(PASTA, nomeArquivo(rotulo || chave));
    const registro = { id: chave, arquivo, pasta: PASTA, segundos: 0, duracao: 0, progresso: 0, terminou: false, erro: '', tamanho: 0, iniciadoEm: Date.now() };
    trabalhos.set(chave, registro);

    let binario;
    try { binario = await ffmpegPath(); }
    catch (erro) { registro.erro = 'sem ffmpeg: ' + String(erro.message).slice(0, 80); registro.terminou = true; return resumo(chave); }

    registro.duracao = await duracaoDe(url, referer);
    const cabecalhos = `User-Agent: ${UA}\r\n` + (referer ? `Referer: ${referer}\r\n` : '');
    const argumentos = [
        '-hide_banner', '-y', '-loglevel', 'info',
        '-headers', cabecalhos,
        '-i', url,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c', 'copy',
        '-movflags', '+faststart',
        '-f', 'mp4',
        arquivo,
    ];
    try {
        const processo = spawn(binario, argumentos, { windowsHide: true });
        registro.processo = processo;
        let ultimoErro = '';
        processo.stderr.on('data', (pedaco) => {
            const texto = String(pedaco);
            const achado = texto.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
            if (achado) {
                registro.segundos = Number(achado[1]) * 3600 + Number(achado[2]) * 60 + Number(achado[3]);
                registro.progresso = registro.duracao > 0
                    ? Math.min(99, Math.round((registro.segundos / registro.duracao) * 100))
                    : Math.min(95, Math.round(registro.segundos / 6));
            }
            if (/error|Invalid data|Server returned|No such file/i.test(texto)) ultimoErro = texto.trim().slice(-140);
        });
        processo.on('exit', (codigo) => {
            registro.terminou = true;
            try { registro.tamanho = fs.statSync(arquivo).size; } catch { registro.tamanho = 0; }
            if (codigo === 0 && registro.tamanho > 0) { registro.progresso = 100; registro.pronto = true; }
            else { registro.erro = ultimoErro || 'não consegui baixar este episódio agora'; try { fs.unlinkSync(arquivo); } catch { /* nada a apagar */ } }
        });
        processo.on('error', (erro) => { registro.erro = String(erro.message).slice(0, 120); registro.terminou = true; });
    } catch (erro) { registro.erro = String(erro.message).slice(0, 120); registro.terminou = true; }
    return resumo(chave);
}

function resumo(chave) {
    const registro = trabalhos.get(chave);
    if (!registro) return { id: chave, pronto: false, progresso: 0, erro: 'download não encontrado' };
    if (!registro.tamanho) { try { registro.tamanho = fs.statSync(registro.arquivo).size; } catch { registro.tamanho = 0; } }
    return {
        id: chave,
        pronto: Boolean(registro.pronto),
        terminou: Boolean(registro.terminou),
        progresso: registro.progresso || 0,
        segundos: registro.segundos || 0,
        duracao: registro.duracao || 0,
        tamanho: registro.tamanho || 0,
        arquivo: registro.arquivo,
        pasta: registro.pasta,
        erro: registro.erro || '',
    };
}

function estado(chave) { return resumo(String(chave || '')); }
function cancelar(chave) {
    const registro = trabalhos.get(String(chave || ''));
    if (!registro || !registro.processo) return false;
    try { registro.processo.kill(); } catch { /* já terminou */ }
    registro.terminou = true;
    registro.erro = 'download cancelado';
    return true;
}

module.exports = { iniciar, estado, cancelar, PASTA };
