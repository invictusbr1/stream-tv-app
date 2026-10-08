'use strict';
// Conversor do Conecta TV.
//
// Alguns fornecedores entregam o filme em MKV com som EAC3/AC3 — o navegador
// toca o vídeo, mas fica MUDO (medido no FenixFlix em 08/10/2026). Aqui o
// aplicativo converte o arquivo, sem perder qualidade de imagem:
//
//   - o vídeo é COPIADO (não perde nada e é rápido);
//   - só o áudio é convertido para AAC (formato que toca em qualquer aparelho);
//   - a faixa escolhida é a de PORTUGUÊS (quando o arquivo informa o idioma);
//   - a saída é HLS (a mesma lista que o player já usa): começa a tocar em
//     segundos, enquanto o resto ainda converte, e permite avançar dentro do
//     trecho já convertido.
//
// O ffmpeg é o mesmo usado pela central (baixado uma única vez). Tudo fica em
// %USERPROFILE%\.conecta-tv\conversoes, com limpeza automática.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PASTA = path.join(os.homedir(), '.conecta-tv', 'conversoes');
const MAXIMO_ARQUIVOS = 6;
const VALIDADE = 3 * 24 * 60 * 60 * 1000; // 3 dias
const PRONTO_PARA_TOCAR = 0.03;            // 3% já dá para começar
const MINIMO_TOCAVEL = 20;                 // ou 20 segundos de vídeo

const trabalhos = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function limparAntigos() {
    try {
        fs.mkdirSync(PASTA, { recursive: true });
        const arquivos = fs.readdirSync(PASTA)
            .map(nome => ({ nome, caminho: path.join(PASTA, nome), info: fs.statSync(path.join(PASTA, nome)) }))
            .filter(item => item.info.isFile())
            .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
        for (const item of arquivos) {
            const velho = Date.now() - item.info.mtimeMs > VALIDADE;
            const excedente = arquivos.indexOf(item) >= MAXIMO_ARQUIVOS;
            const emUso = [...trabalhos.values()].some(t => t.arquivo === item.caminho && !t.terminou);
            if ((velho || excedente) && !emUso) { try { fs.unlinkSync(item.caminho); } catch { /* segue */ } }
        }
    } catch { /* sem permissão: segue */ }
}

function identificar(titulo) {
    const limpo = String(titulo || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
    return `${limpo}-${Date.now().toString(36)}`;
}

async function ffmpegPath() {
    const central = require('./central/verificar-midia');
    const ferramentas = await central.garantirFerramentas(() => { /* silencioso no aplicativo */ });
    return ferramentas.ffmpeg;
}

// Descobre a faixa de áudio em português (e a duração) do arquivo de origem.
async function faixaPortuguesa(url, referer) {
    try {
        const central = require('./central/verificar-midia');
        const faixas = await central.faixasDeAudio(url, referer);
        if (!faixas || !faixas.faixas.length) return { indice: 0, duracao: 0 };
        const portuguesa = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
        return { indice: portuguesa ? portuguesa.ordem : 0, duracao: Number(faixas.duracao) || 0 };
    } catch { return { indice: 0, duracao: 0 }; }
}

// Inicia (ou reaproveita) a conversão de um endereço.
async function iniciar(url, { titulo = '', referer = '', id = '' } = {}) {
    const chave = id || identificar(titulo);
    const existente = trabalhos.get(chave);
    if (existente && !existente.terminou && !existente.erro) return resumo(chave);
    if (existente && existente.arquivo && fs.existsSync(existente.arquivo) && existente.terminou) return resumo(chave);

    limparAntigos();
    const pasta = path.join(PASTA, chave);
    try { fs.mkdirSync(pasta, { recursive: true }); } catch { /* sem permissão */ }
    const arquivo = path.join(pasta, 'index.m3u8');
    const registro = { arquivo, pasta, segundos: 0, duracao: 0, pronto: false, terminou: false, erro: '', iniciadoEm: Date.now(), processo: null };
    trabalhos.set(chave, registro);

    let binario;
    try { binario = await ffmpegPath(); } catch (erro) { registro.erro = 'conversor indisponível: ' + String(erro.message).slice(0, 80); return resumo(chave); }
    const { indice, duracao } = await faixaPortuguesa(url, referer);
    registro.duracao = duracao;

    const cabecalhos = `User-Agent: ${UA}\r\n` + (referer ? `Referer: ${referer}\r\n` : '');
    const argumentos = [
        '-hide_banner', '-y', '-loglevel', 'info',
        '-headers', cabecalhos,
        '-i', url,
        '-map', '0:v:0',
        '-map', `0:a:${indice}`,
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        // HLS: o player começa com os primeiros pedaços e a lista cresce
        // enquanto a conversão continua (formato que o aplicativo já domina).
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_playlist_type', 'event',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(pasta, 'seg%05d.ts'),
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
                if (registro.duracao > 0) registro.progresso = Math.min(99, Math.round((registro.segundos / registro.duracao) * 100));
                else registro.progresso = Math.min(99, Math.round((registro.segundos / 3600) * 10));
                if (!registro.pronto && (registro.progresso >= PRONTO_PARA_TOCAR * 100 || registro.segundos >= MINIMO_TOCAVEL)) registro.pronto = true;
            }
            if (/error|Invalid data|Server returned/i.test(texto)) ultimoErro = texto.trim().slice(-120);
        });
        processo.on('exit', (codigo) => {
            registro.terminou = true;
            registro.emUso = false;
            if (codigo === 0) { registro.pronto = true; registro.progresso = 100; }
            else if (!registro.pronto && !fs.existsSync(arquivo)) registro.erro = ultimoErro || 'não consegui converter o arquivo';
            else registro.pronto = true; // parou no meio, mas o trecho já serve
        });
        processo.on('error', (erro) => { registro.erro = String(erro.message).slice(0, 100); registro.terminou = true; });
    } catch (erro) { registro.erro = String(erro.message).slice(0, 100); registro.terminou = true; }
    return resumo(chave);
}

function resumo(chave) {
    const registro = trabalhos.get(chave);
    if (!registro) return { id: chave, pronto: false, progresso: 0, erro: 'conversão não encontrada' };
    let tamanho = 0;
    try {
        if (registro.pasta && fs.existsSync(registro.pasta)) {
            tamanho = fs.readdirSync(registro.pasta).reduce((soma, nome) => {
                try { return soma + fs.statSync(path.join(registro.pasta, nome)).size; } catch { return soma; }
            }, 0);
        }
    } catch { /* sem arquivo ainda */ }
    return {
        id: chave,
        pronto: Boolean(registro.pronto),
        progresso: registro.progresso || 0,
        segundos: registro.segundos || 0,
        duracao: registro.duracao || 0,
        convertido: Boolean(registro.terminou),
        tamanho,
        erro: registro.erro || '',
    };
}

function estado(chave) { return resumo(chave); }
function arquivoDe(chave) {
    const registro = trabalhos.get(chave);
    if (registro && fs.existsSync(registro.arquivo)) return registro.arquivo;
    const direto = path.join(PASTA, String(chave || '').replace(/[^\w.-]/g, ''), 'index.m3u8');
    return fs.existsSync(direto) ? direto : '';
}

// Caminho seguro de um pedaço da conversão (lista e segmentos).
function caminhoDoPedaço(chave, nome) {
    const pasta = path.join(PASTA, String(chave || '').replace(/[^\w.-]/g, ''));
    const alvo = path.join(pasta, String(nome || 'index.m3u8').replace(/[^\w.-]/g, ''));
    if (!alvo.startsWith(pasta)) return '';
    return fs.existsSync(alvo) ? alvo : '';
}

function encerrarTudo() {
    for (const registro of trabalhos.values()) {
        try { if (registro.processo) registro.processo.kill(); } catch { /* já saiu */ }
    }
}

module.exports = { iniciar, estado, arquivoDe, caminhoDoPedaço, resumo, encerrarTudo, PASTA, identificar };
