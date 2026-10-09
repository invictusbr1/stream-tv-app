// Encaminhamento de mídia do Conecta TV.
//
// Alguns provedores de vídeo entregam o filme em Full HD, mas exigem um
// "referer" que o navegador não consegue enviar (e alguns não liberam o
// acesso entre sites, o que impediria o player de tocar). O aplicativo busca
// o vídeo no servidor e repassa ao player: assim o filme toca limpo, sem
// abrir a página do provedor e sem anúncio no caminho do usuário.
//
// Técnica baseada no projeto aberto TMDB-Embed-API (licença MIT).

const HOSTS_PERMITIDOS = [
    /(^|\.)vixsrc\.to$/i,
    /(^|\.)mistyreef77\.boats$/i, // servidor de vídeo do Vixsrc
    /(^|\.)hclod\.qzz\.io$/i // servidor de vídeo da fonte dublada limpa
];

// Endereços liberados na hora pelos resolvedores do próprio aplicativo (as
// fontes trocam de servidor de vídeo com frequência). Só entra aqui o que o
// aplicativo descobriu sozinho — a lista continua fechada para o resto.
const HOSTS_DESCOBERTOS = new Set();

function liberarHost(host) {
    const nome = String(host || '').trim().toLowerCase();
    if (nome) HOSTS_DESCOBERTOS.add(nome);
}

const REFERERS_CONHECIDOS = {
    'vixsrc.to': 'https://vixsrc.to/',
    'mistyreef77.boats': 'https://vixsrc.to/',
    'hclod.qzz.io': 'https://watchplay.shop/'
};

const UA_VALIDACAO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Confere se o endereço realmente entrega VÍDEO antes de mandar para o player.
//
// As fontes trocam de servidor sem avisar: em 09/10/2026 o PipocaCine passou a
// devolver uma página de erro ("Credenciais inválidas", HTTP 401) em vez do
// arquivo, e o aplicativo só descobria isso depois de tentar tocar — o filme
// ficava parado até cair para a próxima fonte. Com esta checagem a fonte ruim é
// descartada na hora e o filme já abre pela fonte seguinte.
async function validarMidia(url, referer, tempo = 5000) {
    const endereco = String(url || '');
    if (!endereco) return false;
    if (endereco.startsWith('/')) return true; // caminho interno do aplicativo
    let host = '';
    try { host = new URL(endereco).hostname; } catch { return false; }
    const cabecalhos = { 'User-Agent': UA_VALIDACAO, Accept: '*/*', Range: 'bytes=0-2047' };
    const referencia = referer || refererPadrao(host);
    if (referencia) cabecalhos.Referer = referencia;
    try {
        const axios = require('axios');
        const resposta = await axios.get(endereco, {
            headers: cabecalhos,
            timeout: tempo,
            responseType: 'arraybuffer',
            maxRedirects: 4,
            maxContentLength: 1024 * 1024,
            validateStatus: status => status < 600
        });
        if (resposta.status >= 400) return false;
        const tipo = String(resposta.headers['content-type'] || '').toLowerCase();
        if (/text\/html|application\/json|text\/xml|application\/xhtml/.test(tipo)) return false;
        return true;
    } catch { return false; }
}

function hostPermitido(host) {
    const nome = String(host || '');
    if (!nome) return false;
    if (HOSTS_DESCOBERTOS.has(nome.toLowerCase())) return true;
    return HOSTS_PERMITIDOS.some(padrao => padrao.test(nome));
}

function refererPadrao(host) {
    const nome = String(host || '').toLowerCase();
    for (const [sufixo, referer] of Object.entries(REFERERS_CONHECIDOS)) {
        if (nome === sufixo || nome.endsWith(`.${sufixo}`)) return referer;
    }
    return '';
}

function base64url(texto) {
    return Buffer.from(String(texto), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textoDeBase64url(valor) {
    return Buffer.from(String(valor || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Monta o endereço pelo qual o player pede o vídeo ao aplicativo.
function urlViaProxy(url, referer, pai) {
    const partes = [`u=${base64url(url)}`];
    if (referer) partes.push(`r=${base64url(referer)}`);
    if (pai) partes.push(`p=${base64url(pai)}`);
    return `/api/hls?${partes.join('&')}`;
}

// Reescreve a lista de reprodução para que cada pedaço do filme também
// passe pelo aplicativo (o player nunca fala direto com o provedor).
function reescreverPlaylist(texto, base, referer) {
    const encaminhar = valor => {
        let absoluto;
        let host = '';
        try {
            absoluto = new URL(valor, base).href;
            host = new URL(absoluto).hostname;
        } catch {
            return valor;
        }
        if (!hostPermitido(host)) return valor;
        return urlViaProxy(absoluto, referer || refererPadrao(host), base);
    };
    return String(texto)
        .split('\n')
        .map(linha => {
            const limpa = linha.trim();
            if (!limpa) return linha;
            if (limpa.startsWith('#')) return linha.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${encaminhar(uri)}"`);
            return encaminhar(limpa);
        })
        .join('\n');
}

module.exports = {
    hostPermitido,
    liberarHost,
    refererPadrao,
    base64url,
    textoDeBase64url,
    urlViaProxy,
    reescreverPlaylist,
    validarMidia
};
