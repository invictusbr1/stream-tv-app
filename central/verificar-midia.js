'use strict';
// Verificação de mídia da central: aqui a fonte é avaliada pelo que ela
// REALMENTE entrega, não pelo que ela diz.
//
//   1. Lê as faixas de áudio do arquivo (idioma e faixa padrão) — rápido;
//   2. Quando não há essa informação, extrai um trecho do áudio com o ffmpeg
//      e manda transcrever na IA (Whisper) para descobrir o idioma;
//   3. Guarda tudo em "dados/idiomas.json" — o aplicativo usa esse arquivo
//      para não cair de novo numa fonte que entrega o idioma errado.
//
// O ffmpeg/ffprobe são baixados uma única vez (build oficial) e ficam em
// %USERPROFILE%\.conecta-central — nada é instalado no sistema.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');
const { execFile } = require('child_process');

const PASTA = path.join(os.homedir(), '.conecta-central');
const ARQ_FFMPEG = path.join(PASTA, 'ffmpeg.exe');
const ARQ_FFPROBE = path.join(PASTA, 'ffprobe.exe');
// Espelhos do pacote oficial: o primeiro (GitHub) costuma ser bem mais rápido.
const ZIP_URLS = [
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function pastaDados(central) {
    return (central && central.pastaDados) || path.join(__dirname, 'dados');
}
function arquivoCache(central) {
    return path.join(pastaDados(central), 'idiomas.json');
}

// ---------------------------------------------------------------- ferramentas
function acharInstalado() {
    const tentativas = [
        { ffmpeg: process.env.FFMPEG_PATH || '', ffprobe: process.env.FFPROBE_PATH || '' },
        { ffmpeg: ARQ_FFMPEG, ffprobe: ARQ_FFPROBE },
        { ffmpeg: path.join(__dirname, 'ferramentas', 'ffmpeg.exe'), ffprobe: path.join(__dirname, 'ferramentas', 'ffprobe.exe') },
        { ffmpeg: path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'), ffprobe: '' },
    ];
    for (const opcao of tentativas) {
        if (opcao.ffmpeg && fs.existsSync(opcao.ffmpeg)) {
            const ffprobe = opcao.ffprobe && fs.existsSync(opcao.ffprobe) ? opcao.ffprobe : '';
            return { ffmpeg: opcao.ffmpeg, ffprobe };
        }
    }
    return null;
}

// Leitor mínimo de .zip (o mesmo princípio usado nas legendas do aplicativo).
function extrairDoZip(buffer, procurados) {
    const bruto = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    let fim = -1;
    for (let i = bruto.length - 22; i >= 0 && i > bruto.length - 65558; i--) {
        if (bruto[i] === 0x50 && bruto[i + 1] === 0x4b && bruto[i + 2] === 0x05 && bruto[i + 3] === 0x06) { fim = i; break; }
    }
    if (fim < 0) return null;
    const total = bruto.readUInt16LE(fim + 10);
    let ponteiro = bruto.readUInt32LE(fim + 16);
    const achados = {};
    for (let n = 0; n < total && ponteiro + 46 <= bruto.length; n++) {
        if (bruto.readUInt32LE(ponteiro) !== 0x02014b50) break;
        const metodo = bruto.readUInt16LE(ponteiro + 10);
        const comprimido = bruto.readUInt32LE(ponteiro + 20);
        const nomeTamanho = bruto.readUInt16LE(ponteiro + 28);
        const extraTamanho = bruto.readUInt16LE(ponteiro + 30);
        const comentarioTamanho = bruto.readUInt16LE(ponteiro + 32);
        const local = bruto.readUInt32LE(ponteiro + 42);
        const nome = bruto.slice(ponteiro + 46, ponteiro + 46 + nomeTamanho).toString('utf8');
        ponteiro += 46 + nomeTamanho + extraTamanho + comentarioTamanho;
        const chave = procurados.find(alvo => nome.toLowerCase().endsWith(alvo));
        if (!chave || achados[chave]) continue;
        const nomeLocal = bruto.readUInt16LE(local + 26);
        const extraLocal = bruto.readUInt16LE(local + 28);
        const inicio = local + 30 + nomeLocal + extraLocal;
        try {
            achados[chave] = metodo === 0 ? bruto.slice(inicio, inicio + comprimido) : zlib.inflateRawSync(bruto.slice(inicio, inicio + comprimido));
        } catch { /* tenta os próximos */ }
    }
    return achados;
}

let ferramentas = null;
let baixando = null;

// Garante o ffmpeg/ffprobe no computador (baixa uma vez, se faltar).
async function garantirFerramentas(registrar = () => {}) {
    if (ferramentas && fs.existsSync(ferramentas.ffmpeg)) return ferramentas;
    const instalado = acharInstalado();
    if (instalado) { ferramentas = instalado; return instalado; }

    if (!baixando) {
        baixando = (async () => {
            fs.mkdirSync(PASTA, { recursive: true });
            registrar('baixando o conversor de áudio (ffmpeg) — só na primeira vez…');
            let pacote = null;
            let ultimoErro = null;
            for (const endereco of ZIP_URLS) {
                try {
                    const resposta = await axios.get(endereco, { responseType: 'arraybuffer', timeout: 900000, maxContentLength: 400 * 1024 * 1024, headers: { 'User-Agent': UA } });
                    pacote = Buffer.from(resposta.data);
                    break;
                } catch (erro) { ultimoErro = erro; }
            }
            if (!pacote) throw ultimoErro || new Error('não consegui baixar o conversor');
            const arquivos = extrairDoZip(pacote, ['/ffmpeg.exe', '/ffprobe.exe']);
            if (!arquivos || !arquivos['/ffmpeg.exe']) throw new Error('não achei o ffmpeg dentro do pacote');
            fs.writeFileSync(ARQ_FFMPEG, arquivos['/ffmpeg.exe']);
            if (arquivos['/ffprobe.exe']) fs.writeFileSync(ARQ_FFPROBE, arquivos['/ffprobe.exe']);
            ferramentas = { ffmpeg: ARQ_FFMPEG, ffprobe: fs.existsSync(ARQ_FFPROBE) ? ARQ_FFPROBE : '' };
            registrar('conversor pronto');
            return ferramentas;
        })().catch(erro => { baixando = null; throw erro; });
    }
    return baixando;
}

// ---------------------------------------------------------------- execução
function rodar(programa, argumentos, timeout = 120000) {
    return new Promise(resolve => {
        execFile(programa, argumentos, { timeout, maxBuffer: 24 * 1024 * 1024, windowsHide: true }, (erro, saida, erroSaida) => {
            resolve({ erro, saida: String(saida || ''), erroSaida: String(erroSaida || '') });
        });
    });
}

function cabecalho(referer) {
    const linhas = [`User-Agent: ${UA}`];
    if (referer) linhas.push(`Referer: ${referer}`);
    return linhas.join('\r\n') + '\r\n';
}

// Faixas de áudio com idioma e marcação de padrão (quando o arquivo informa).
async function faixasDeAudio(url, referer = '') {
    const f = await garantirFerramentas();
    if (!f.ffprobe) return null;
    const { erro, saida } = await rodar(f.ffprobe, [
        '-v', 'error', '-headers', cabecalho(referer),
        '-print_format', 'json',
        '-show_streams', '-show_format',
        url,
    ], 90000);
    if (erro) return null;
    let dados;
    try { dados = JSON.parse(saida); } catch { return null; }
    const audio = (dados.streams || []).filter(s => s.codec_type === 'audio');
    if (!audio.length) return null;
    return {
        container: dados.format && dados.format.format_name || '',
        faixas: audio.map((s, i) => ({
            ordem: i,
            idioma: String((s.tags || {}).language || '').toLowerCase(),
            padrao: Number((s.disposition || {}).default || 0) === 1,
            codec: String(s.codec_name || '').toLowerCase(),
        })),
    };
}

// O navegador toca o vídeo, mas nem sempre o áudio: EAC3/AC3 dentro de MKV,
// por exemplo, sai mudo (medido no fornecedor FenixFlix em 08/10/2026).
function audioTocaNoNavegador(container, codec) {
    const embalagem = String(container || '').toLowerCase();
    const som = String(codec || '').toLowerCase();
    if (!som) return true;
    if (/matroska|webm/.test(embalagem)) return /aac|opus|vorbis|mp3|flac|pcm/.test(som);
    return /aac|mp3|ac3|eac3|opus|vorbis|flac|pcm/.test(som);
}

// Extrai um trecho e manda transcrever — descobre o idioma que está tocando.
async function ouvirIdioma(url, { referer = '', inicio = 300, segundos = 20, chave = '' } = {}) {
    if (!chave) return null;
    const f = await garantirFerramentas();
    const arquivo = path.join(os.tmpdir(), `conecta-ouvir-${Date.now()}.webm`);
    const { erro } = await rodar(f.ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-headers', cabecalho(referer),
        '-ss', String(inicio), '-t', String(segundos),
        '-i', url,
        '-vn', '-ac', '1', '-ar', '16000',
        '-f', 'webm', '-y', arquivo,
    ], 180000);
    if (erro || !fs.existsSync(arquivo)) return null;
    try {
        const conteudo = fs.readFileSync(arquivo);
        const limite = '----conecta' + Date.now();
        const corpo = Buffer.concat([
            Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
            conteudo,
            Buffer.from(`\r\n--${limite}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n--${limite}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n--${limite}--\r\n`),
        ]);
        const r = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', corpo, {
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + limite, Authorization: 'Bearer ' + chave },
            timeout: 120000, maxBodyLength: Infinity,
        });
        const texto = String(r.data.text || '').trim();
        const bruto = String(r.data.language || '').toLowerCase();
        // A IA pode responder "pt", "por", "portuguese" ou "português" — todas
        // valem como português. O resto é outro idioma.
        const ehPortugues = /^(pt|por|portugu)/.test(bruto);
        const idioma = bruto ? (ehPortugues ? 'pt' : 'outro') : (parecePortugues(texto) ? 'pt' : 'outro');
        return { idioma, idiomaBruto: bruto || 'desconhecido', texto: texto.slice(0, 160), origem: 'transcricao' };
    } catch { return null; }
    finally { try { fs.unlinkSync(arquivo); } catch { /* já foi */ } }
}

// Heurística simples para quando a IA não devolve o idioma: palavras comuns.
const PALAVRAS_PT = [' que ', ' não ', ' voce', ' você', ' para ', ' com ', ' uma ', ' está', ' isso ', ' aqui ', ' tudo ', ' bem ', ' agora ', ' depois ', ' muito '];
function parecePortugues(texto) {
    const alvo = ` ${String(texto || '').toLowerCase()} `;
    if (alvo.trim().length < 12) return false;
    const pontos = PALAVRAS_PT.filter(p => alvo.includes(p)).length;
    return pontos >= 2;
}

// ---------------------------------------------------------------- cache
let cache = null;
function lerCache(central) {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(arquivoCache(central), 'utf8')) || {}; } catch { cache = {}; }
    return cache;
}
function gravarCache(central) {
    try {
        fs.mkdirSync(pastaDados(central), { recursive: true });
        fs.writeFileSync(arquivoCache(central), JSON.stringify(cache || {}, null, 1));
    } catch { /* sem permissão: segue só na memória */ }
}

// Chave igual à usada pelo motor do aplicativo ("movie:921", "tv:1399:1:1").
function chaveDoTitulo(tipo, amostra) {
    return tipo === 'tv'
        ? `tv:${amostra.id}:${amostra.temporada || 1}:${amostra.episodio || 1}`
        : `movie:${amostra.id}`;
}

// Verifica o idioma de uma fonte para um título. Primeiro tenta a informação
// do próprio arquivo (faixa padrão em português); se não houver, ouve.
async function verificarIdioma({ url, referer = '', tipo = 'movie', amostra, fonteId = '', chaveIa = '', central, registrar = () => {} }) {
    if (!url || !amostra) return null;
    const chave = `${fonteId}|${chaveDoTitulo(tipo, amostra)}`;
    const guardado = lerCache(central)[chave];
    if (guardado && Date.now() - new Date(guardado.em).getTime() < 7 * 24 * 60 * 60 * 1000) return { ...guardado, cache: true };

    const registro = lerCache(central);
    let resultado = null;
    try {
        const faixas = await faixasDeAudio(url, referer);
        if (faixas && faixas.faixas.length) {
            const pt = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
            const outraPadrao = faixas.faixas.find(f => f.padrao && !/^pt|por/.test(f.idioma));
            if (pt && (pt.padrao || !outraPadrao)) {
                const toca = audioTocaNoNavegador(faixas.container, pt.codec);
                resultado = {
                    idioma: 'pt',
                    evidencia: `faixa de áudio em português${pt.padrao ? ' (padrão do arquivo)' : ''}`,
                    origem: 'faixas',
                    ...(toca ? {} : { avisoAudio: `o áudio deste arquivo (${String(pt.codec || 'desconhecido').toUpperCase()} dentro de ${faixas.container.split(',')[0]}) sai mudo no navegador` }),
                };
            } else if (!pt && outraPadrao) {
                resultado = { idioma: 'outro', evidencia: `a faixa padrão do arquivo é "${outraPadrao.idioma || 'outro idioma'}"`, origem: 'faixas' };
            } else if (!pt && !outraPadrao) {
                resultado = { idioma: 'indefinido', evidencia: 'o arquivo não informa o idioma das faixas', origem: 'faixas' };
            }
        }
        if (!resultado || resultado.idioma === 'indefinido') {
            registrar(`ouvindo um trecho de ${amostra.titulo || 'título'} para confirmar o idioma…`);
            const ouvido = await ouvirIdioma(url, { referer, chave: chaveIa, inicio: 240, segundos: 20 });
            if (ouvido) {
                const apelido = ouvido.idiomaBruto && ouvido.idiomaBruto !== 'desconhecido' ? ` (${ouvido.idiomaBruto})` : '';
                resultado = {
                    idioma: ouvido.idioma,
                    evidencia: `transcrição${apelido}: "${ouvido.texto.slice(0, 90)}${ouvido.texto.length > 90 ? '…' : ''}"`,
                    origem: 'transcricao',
                };
            }
        }
    } catch (erro) {
        resultado = { idioma: 'indefinido', evidencia: 'não consegui medir agora: ' + String(erro.message).slice(0, 60), origem: 'erro' };
    }
    if (!resultado) resultado = { idioma: 'indefinido', evidencia: 'sem medição', origem: 'erro' };
    registro[chave] = { ...resultado, fonteId, titulo: chaveDoTitulo(tipo, amostra), em: new Date().toISOString() };
    gravarCache(central);
    return registro[chave];
}

function limparCache() { cache = null; }

module.exports = {
    garantirFerramentas, faixasDeAudio, ouvirIdioma, verificarIdioma,
    parecePortugues, extrairDoZip, chaveDoTitulo, lerCache, gravarCache, limparCache, audioTocaNoNavegador,
    arquivoCache, PASTA,
};
