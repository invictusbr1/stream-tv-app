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
// Em Linux/contêiner os binários não têm extensão e vêm do gerenciador de
// pacotes. Procurar só ".exe" fazia a medição de idioma falhar em silêncio no
// servidor: sem ffprobe não há faixas de áudio, sem ffmpeg não há transcrição, e
// aí o "audio: pt-BR" que a fonte DECLARA nunca é desmentido.
const NOME_FFMPEG = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const NOME_FFPROBE = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
const ARQ_FFMPEG = path.join(PASTA, NOME_FFMPEG);
const ARQ_FFPROBE = path.join(PASTA, NOME_FFPROBE);
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
// Procura o ffmpeg/ffprobe no PATH do sistema (caso do contêiner Linux, onde
// eles vêm de `apk add ffmpeg` e ficam em /usr/bin).
function acharNoSistema() {
    const pastas = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    // Locais comuns, para quando o PATH do serviço vier reduzido.
    pastas.push('/usr/bin', '/usr/local/bin', '/bin');
    for (const pasta of pastas) {
        const ffmpeg = path.join(pasta, NOME_FFMPEG);
        if (!fs.existsSync(ffmpeg)) continue;
        const ffprobe = path.join(pasta, NOME_FFPROBE);
        return { ffmpeg, ffprobe: fs.existsSync(ffprobe) ? ffprobe : '' };
    }
    return null;
}

function acharInstalado() {
    const tentativas = [
        { ffmpeg: process.env.FFMPEG_PATH || '', ffprobe: process.env.FFPROBE_PATH || '' },
        { ffmpeg: ARQ_FFMPEG, ffprobe: ARQ_FFPROBE },
        {
            ffmpeg: path.join(__dirname, 'ferramentas', NOME_FFMPEG),
            ffprobe: path.join(__dirname, 'ferramentas', NOME_FFPROBE),
        },
        {
            ffmpeg: path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', NOME_FFMPEG),
            ffprobe: '',
        },
        // As duas de cima são o caso Windows/empacotado. Esta é a do servidor.
        acharNoSistema(),
    ].filter(Boolean);
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
async function faixasDeAudio(url, referer = '', opcoes = {}) {
    const f = await garantirFerramentas();
    if (!f.ffprobe) return null;
    const { erro, saida } = await rodar(f.ffprobe, [
        '-v', 'error', '-headers', cabecalho(referer),
        '-print_format', 'json',
        '-show_streams', '-show_format',
        url,
    ], Math.max(1000, Math.min(90000, Number(opcoes.timeout) || 90000)));
    if (erro) return null;
    let dados;
    try { dados = JSON.parse(saida); } catch { return null; }
    const audio = (dados.streams || []).filter(s => s.codec_type === 'audio');
    if (!audio.length) return null;
    const video = (dados.streams || []).find(s => s.codec_type === 'video') || {};
    return {
        container: dados.format && dados.format.format_name || '',
        duracao: Number((dados.format && dados.format.duration) || 0) || 0,
        imagem: { largura: Number(video.width) || 0, altura: Number(video.height) || 0,
            codec: String(video.codec_name || '').toLowerCase(), pixels: String(video.pix_fmt || '') },
        faixas: audio.map((s, i) => ({
            ordem: i,
            idioma: String((s.tags || {}).language || '').toLowerCase(),
            padrao: Number((s.disposition || {}).default || 0) === 1,
            codec: String(s.codec_name || '').toLowerCase(),
        })),
    };
}

// ---------------------------------------------------------------- leitura barata
// Estas duas leituras respondem "esta fonte tem áudio em português?" SEM gastar
// IA e quase sem tempo. É o que permite ao caçador testar dez vezes mais
// candidatas: só as que passam por aqui (ou ficam sem resposta) vão para a
// transcrição, que é a parte cara.

function textoDe(url, referer = '', limite = 300000) {
    return axios.get(url, {
        timeout: 12000,
        responseType: 'text',
        maxRedirects: 4,
        maxContentLength: limite,
        validateStatus: s => s < 400,
        headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    }).then(r => String(r.data || ''));
}

// Numa lista de reprodução (HLS) a própria lista diz o idioma do áudio:
// "#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE=\"pt\",NAME=\"Português\"" — ou o nome do
// grupo ("Dublado", "Dub", "PT-BR"). Isso responde idioma sem abrir o arquivo.
function idiomaNaLista(texto) {
    if (typeof texto !== 'string' || !/#EXTM3U/i.test(texto)) return null;
    const trechos = [];
    for (const linha of texto.split(/\r?\n/)) {
        if (!/^#EXT-X-MEDIA/i.test(linha)) continue;
        if (!/TYPE=AUDIO/i.test(linha)) continue;
        trechos.push(linha);
    }
    const procurado = (trechos.length ? trechos : texto.split(/\r?\n/)).join(' ').toLowerCase();
    const portugues = /language="(pt|por|pob)[^"]*"|name="[^"]*(portugu|dublad|dub|pt-br|brasil)[^"]*"|group-id="[^"]*(portugu|dublad|dub|pt-br)[^"]*"/i;
    const outro = /language="(en|eng|es|spa|ja|jpn|ko|kor|zh|chi|fr|fra|de|deu|it|ita|tr|tur|hi|hin|ar|ara)[^"]*"/i;
    if (portugues.test(procurado)) return { idioma: 'pt', evidencia: 'a lista de reprodução declara faixa de áudio em português' };
    if (outro.test(procurado)) {
        const achado = outro.exec(procurado);
        return { idioma: 'outro', evidencia: `a lista de reprodução declara áudio em "${achado[1]}"` };
    }
    return null;
}

// Sondagem rápida: a fonte está viva? qual resolução? qual idioma pelo arquivo?
// Junta o ffprobe (que já leva poucos segundos) com a leitura da lista.
async function sondagemRapida(url, referer = '') {
    const inicio = Date.now();
    const saida = { viva: false, ms: 0, container: '', altura: 0, idiomas: [], dublado: null, evidencia: '' };
    if (!url) return saida;
    const ehLista = /\.m3u8(\?|$)/i.test(url);
    try {
        if (ehLista) {
            const texto = await textoDe(url, referer);
            if (/#EXTM3U/i.test(texto)) {
                saida.viva = true;
                const prova = idiomaNaLista(texto);
                if (prova) { saida.dublado = prova.idioma === 'pt'; saida.evidencia = prova.evidencia; saida.idiomas = [prova.idioma === 'pt' ? 'por' : 'outro']; }
            }
        }
    } catch { /* segue para o ffprobe */ }
    try {
        const faixas = await faixasDeAudio(url, referer);
        if (faixas) {
            saida.viva = true;
            saida.container = faixas.container;
            saida.altura = faixas.imagem.altura || 0;
            saida.idiomas = faixas.faixas.map(f => f.idioma).filter(Boolean);
            const pt = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
            // Faixa marcada como "und" (indefinida) NÃO prova que o áudio é de
            // outro idioma: só uma faixa com idioma declarado e diferente do
            // português conta como contradição.
            const declarado = idioma => Boolean(idioma) && idioma !== 'und' && !/^pt|por/.test(idioma);
            const outraPadrao = faixas.faixas.find(f => f.padrao && declarado(f.idioma));
            if (pt && (pt.padrao || !outraPadrao)) {
                saida.dublado = true;
                saida.evidencia = saida.evidencia || `faixa de áudio em português${pt.padrao ? ' (padrão do arquivo)' : ''}`;
            } else if (!pt && outraPadrao) {
                saida.dublado = false;
                saida.evidencia = saida.evidencia || `a faixa padrão do arquivo é "${outraPadrao.idioma || 'outro idioma'}"`;
            }
        }
    } catch { /* sem ffprobe: fica só a resposta da lista */ }
    saida.ms = Date.now() - inicio;
    return saida;
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

// O ffmpeg tem uma lista branca de extensões de pedaço em HLS e recusa `.js`
// (o WatchPlay disfarça os pedaços assim). Ele também só aceita http/https
// quando a lista vem de um arquivo local, e recusa `-headers` nesse caso.
// Solução: baixar a lista, deixar cada pedaço com endereço completo e terminar
// em `.ts`, e apontar o ffmpeg para o arquivo. Sem isso a medição dá "sem medição"
// e a fonte dublada perde para uma conversão de áudio qualquer.
async function playListaAceita(url, referer) {
    const bruto = await textoDe(url, referer);
    if (!/#EXTM3U/i.test(bruto)) return '';
    // Lista normal (pedaços .ts/.m4s): o ffmpeg lê direto, sem cópia.
    if (!/^[^#\s]*\.js(\?|$)/im.test(bruto)) return '';
    const corte = url.lastIndexOf('/');
    const base = corte > 8 ? url.slice(0, corte + 1) : '';
    if (!base) return '';
    const ajustar = (alvo) => {
        const completo = /^https?:/i.test(alvo) ? alvo : base + alvo;
        return completo.includes('?') ? completo + '&x=.ts' : completo + '?x=.ts';
    };
    const linhas = bruto.split('\n').map(linha => {
        const t = linha.trim();
        if (t.startsWith('#EXT-X-MAP:')) {
            const achado = /URI="([^"]+)"/.exec(t);
            return achado ? t.replace(achado[1], ajustar(achado[1])) : linha;
        }
        if (t && !t.startsWith('#')) return ajustar(t);
        return linha;
    });
    const guardado = path.join(os.tmpdir(), `conecta-lista-${Date.now()}.m3u8`);
    fs.writeFileSync(guardado, linhas.join('\n'));
    return guardado;
}

// O aplicativo devolve endereços do tipo "/api/convertido/..." e, dentro do
// contêiner da central, "127.0.0.1" é a PRÓPRIA central — não o aplicativo. Sem
// apontar para o nome do serviço, o ffmpeg bate na porta errada e a medição
// termina em "sem medição".
function enderecoAlcancavel(url, referer) {
    const bruto = String(url || '').trim();
    if (!bruto.startsWith('/')) return bruto;
    // `APP_URL` já vem definido pelo compose (http://app:3000).
    const doAmbiente = String(process.env.APP_URL || process.env.CONECTA_APP_URL || '').replace(/\/+$/, '');
    const doReferer = String(referer || '').replace(/\/+$/, '');
    const base = doAmbiente || doReferer;
    return /^https?:\/\//i.test(base) ? base + bruto : bruto;
}

// Cabeçalho completo para o ffmpeg: junta o Referer com os cabeçalhos que a
// própria fonte registrou (o VidLink entrega MP4 que só abre com User-Agent e
// Accept certos). Sem isso o ffmpeg baixa 0 byte e a medição dá "sem medição".
function cabecalhoParaFfmpeg(url, referer) {
    const linhas = [];
    const visto = new Set();
    const juntar = (nome, valor) => {
        if (!valor || typeof valor !== 'string' || /[\r\n]/.test(valor)) return;
        if (visto.has(nome.toLowerCase())) return;
        visto.add(nome.toLowerCase());
        linhas.push(`${nome}: ${valor}`);
    };
    juntar('Referer', referer);
    try { juntar('Origin', new URL(referer).origin); } catch { /* sem origem */ }
    try {
        const registrados = require('../midia-proxy').cabecalhosDaMidia(url) || {};
        for (const [nome, valor] of Object.entries(registrados)) juntar(nome, valor);
    } catch { /* segue só com o Referer */ }
    return linhas.length ? linhas.join('\r\n') + '\r\n' : '';
}

// Extrai um trecho e manda transcrever — descobre o idioma que está tocando.
async function ouvirIdioma(url, { referer = '', inicio = 300, segundos = 20, chave = '' } = {}) {
    if (!chave) return null;
    url = enderecoAlcancavel(url, referer);
    if (!/^https?:\/\//i.test(url)) return null;
    const f = await garantirFerramentas();
    const arquivo = path.join(os.tmpdir(), `conecta-ouvir-${Date.now()}.webm`);
    let listaLocal = '';
    try { listaLocal = await playListaAceita(url, referer); } catch { listaLocal = ''; }
    const entrada = listaLocal || url;
    const comuns = [
        '-hide_banner', '-loglevel', 'error',
        // Sem a liberação, o ffmpeg recusa http/https quando lê de arquivo.
        '-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls',
    ];
    // `-headers` é opção do protocolo http(s): só vale quando a entrada é remota.
    // Com a lista local os pedaços já vêm prontos; o cabeçalho é descartado.
    const bytesCabecalho = listaLocal ? '' : cabecalhoParaFfmpeg(url, referer);
    const cabecalhos = bytesCabecalho ? ['-headers', bytesCabecalho] : [];
    const { erro } = await rodar(f.ffmpeg, [
        ...comuns, ...cabecalhos,
        '-ss', String(inicio), '-t', String(segundos),
        '-i', entrada,
        '-vn', '-ac', '1', '-ar', '16000',
        '-f', 'webm', '-y', arquivo,
    ], 180000);
    if (listaLocal) { try { fs.unlinkSync(listaLocal); } catch { /* já foi */ } }
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
        const arquivo=arquivoCache(central);
        let disco={};try{disco=JSON.parse(fs.readFileSync(arquivo,'utf8'))||{};}catch{}
        // Uma verificação em andamento pode ter carregado uma fotografia
        // antiga. Não apaga provas de outros títulos gravadas depois dela.
        const combinado={...disco};
        for(const [chave,valor]of Object.entries(cache||{})){
            const recente=combinado[chave];
            if(!recente||(Date.parse(valor?.em)||0)>=(Date.parse(recente?.em)||0))combinado[chave]=valor;
        }
        const temporario=arquivo+'.'+process.pid+'.tmp';
        fs.writeFileSync(temporario,JSON.stringify(combinado,null,1));
        fs.renameSync(temporario,arquivo);
        Object.assign(cache||(cache={}),combinado);
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
    const etiquetaAusente=guardado?.idioma==='outro'&&guardado.origem==='faixas'&&/"(?:und|outro idioma)"/i.test(guardado.evidencia||'');
    if (guardado && !etiquetaAusente && Date.now() - new Date(guardado.em).getTime() < 7 * 24 * 60 * 60 * 1000) return { ...guardado, cache: true };

    const registro = lerCache(central);
    let resultado = null;
    try {
        const faixas = await faixasDeAudio(url, referer);
        if (faixas && faixas.faixas.length) {
            const pt = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
            const outraPadrao = faixas.faixas.find(f => f.padrao && f.idioma && f.idioma !== 'und' && !/^pt|por/.test(f.idioma));
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
            // Lista de reprodução (HLS): muitas vezes a própria lista declara o
            // idioma do áudio. Sai bem mais barato que ouvir o trecho.
            if (/\.m3u8(\?|$)/i.test(url)) {
                try {
                    const prova = idiomaNaLista(await textoDe(url, referer));
                    if (prova) resultado = { ...prova, origem: 'lista' };
                } catch { /* sem a lista: tenta ouvir */ }
            }
        }
        if (!resultado || resultado.idioma === 'indefinido') {
            registrar(`ouvindo um trecho de ${amostra.titulo || 'título'} para confirmar o idioma…`);
            // Numa lista de reprodução (HLS) o ffmpeg precisa "correr" até o
            // ponto escolhido — por isso ali o trecho é mais no começo; em
            // arquivo direto o avanço é instantâneo e vale a pena pular a
            // abertura (que costuma ser só música).
            const ehLista = /\.m3u8(\?|$)/i.test(url);
            // Até três janelas: se a primeira cair num trecho sem fala (só
            // música) a transcrição vem curtíssima e não prova nada — aí a
            // verificação insiste num ponto mais adiante do filme.
            const janelas = ehLista ? [45, 150, 300] : [240, 600, 1200];
            for (const inicio of janelas) {
                const ouvido = await ouvirIdioma(url, { referer, chave: chaveIa, inicio, segundos: ehLista ? 25 : 20 });
                if (!ouvido) continue;
                const confiavel = String(ouvido.texto || '').trim().length >= 15;
                const apelido = ouvido.idiomaBruto && ouvido.idiomaBruto !== 'desconhecido' ? ` (${ouvido.idiomaBruto})` : '';
                if (confiavel) {
                    resultado = {
                        idioma: ouvido.idioma,
                        evidencia: `transcrição${apelido} aos ${inicio}s: "${ouvido.texto.slice(0, 90)}${ouvido.texto.length > 90 ? '…' : ''}"`,
                        origem: 'transcricao',
                    };
                    break;
                }
                resultado = { idioma: 'indefinido', evidencia: `trecho com pouca fala aos ${inicio}s — não dá para confirmar o idioma`, origem: 'transcricao' };
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
    // Leitura barata (sem IA): usada pelo caçador para triar candidatas.
    idiomaNaLista, sondagemRapida, textoDe,
};
