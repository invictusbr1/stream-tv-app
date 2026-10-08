'use strict';
// Legendas online do Conecta TV.
//
// Quando o filme toca com o áudio original (não dublado), o aplicativo busca
// sozinho a legenda em português. A fonte usada aqui é o YIFY Subtitles, que é
// aberto (não pede cadastro nem chave) e entrega os arquivos em .zip.
//
// O arquivo baixado é guardado na pasta "Legendas" do aplicativo: na próxima
// vez ele já entra como legenda local, sem depender da internet.

const axios = require('axios');
const zlib = require('zlib');

const BASE = 'https://yifysubtitles.ch';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------------------------------------------------------
// Leitura de arquivo .zip (só o necessário: um arquivo de texto dentro)
// ---------------------------------------------------------------
function acharFimDoDiretorio(buffer) {
    // Assinatura do fim do diretório central do ZIP: PK\x05\x06
    for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65558; i--) {
        if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) return i;
    }
    return -1;
}

function extrairDoZip(buffer) {
    const bruto = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    const fim = acharFimDoDiretorio(bruto);
    if (fim < 0) return null;
    const total = bruto.readUInt16LE(fim + 10);
    let ponteiro = bruto.readUInt32LE(fim + 16);

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

        if (!/\.(srt|vtt|ass|ssa)$/i.test(nome)) continue;
        if (bruto.readUInt32LE(local) !== 0x04034b50) continue;
        const nomeLocal = bruto.readUInt16LE(local + 26);
        const extraLocal = bruto.readUInt16LE(local + 28);
        const inicio = local + 30 + nomeLocal + extraLocal;
        const dados = bruto.slice(inicio, inicio + comprimido);
        try {
            const texto = metodo === 0 ? dados : zlib.inflateRawSync(dados);
            return { nome, texto: texto.toString('utf8') };
        } catch { /* arquivo ilegível: tenta o próximo */ }
    }
    return null;
}

// ---------------------------------------------------------------
// Busca e download no YIFY Subtitles
// ---------------------------------------------------------------
const cache = new Map(); // imdb -> { expira, lista }
const VALIDADE = 30 * 60 * 1000;

function limparNome(valor) {
    return String(valor || '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();
}

// Lista as legendas em português de um filme, pelo código IMDb (tt0000000).
async function listar(imdb) {
    const codigo = String(imdb || '').trim().toLowerCase();
    if (!/^tt\d{5,10}$/.test(codigo)) return [];
    const guardado = cache.get(codigo);
    if (guardado && guardado.expira > Date.now()) return guardado.lista;

    const resposta = await axios.get(`${BASE}/movie-imdb/${codigo}`, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
        timeout: 15000,
        responseType: 'text',
        maxContentLength: 6 * 1024 * 1024,
        validateStatus: status => status === 200
    });
    const html = String(resposta.data || '');
    const lista = [];
    const vistos = new Set();
    for (const linha of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
        const bandeira = (linha.match(/flag-([a-z-]+)/) || [])[1] || '';
        const idioma = limparNome((linha.match(/sub-lang">([^<]+)</) || [])[1] || '');
        const ehPortugues = /portugu/i.test(idioma) || bandeira === 'br' || bandeira === 'pt';
        if (!ehPortugues) continue;
        const caminho = (linha.match(/href="(\/subtitles\/[^"]+)"/) || [])[1] || '';
        if (!caminho || vistos.has(caminho)) continue;
        vistos.add(caminho);
        const nota = Number((linha.match(/label-success">\s*(\d+)/) || [])[1] || 0);
        const titulo = limparNome((linha.match(/<\/span>\s*([^<]+)<\/a>/) || [])[1] || '');
        lista.push({
            nome: titulo || 'Legenda em português',
            idioma: idioma || 'Português',
            pagina: BASE + caminho,
            baixar: BASE + caminho.replace('/subtitles/', '/subtitle/') + '.zip',
            nota
        });
    }
    lista.sort((a, b) => b.nota - a.nota);
    cache.set(codigo, { lista, expira: Date.now() + VALIDADE });
    return lista;
}

// Baixa o .zip da legenda escolhida e devolve { nome, texto }.
async function baixar(endereco) {
    const alvo = String(endereco || '');
    if (!/^https?:\/\/(www\.)?yifysubtitles\.ch\/subtitle\//i.test(alvo)) return null;
    const pagina = alvo.replace('/subtitle/', '/subtitles/').replace(/\.zip$/i, '');
    const resposta = await axios.get(alvo, {
        headers: { 'User-Agent': UA, Referer: pagina, Accept: '*/*' },
        timeout: 20000,
        responseType: 'arraybuffer',
        maxContentLength: 12 * 1024 * 1024,
        maxRedirects: 4,
        validateStatus: status => status === 200
    });
    return extrairDoZip(Buffer.from(resposta.data));
}

module.exports = { listar, baixar, extrairDoZip, BASE };
