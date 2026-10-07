// Fonte dublada limpa para filmes (PipocaCine).
//
// O endereço do filme é publicado na própria página do provedor, mas o vídeo
// toca DENTRO do aplicativo: a página (com os anúncios dela) nunca é aberta
// para o usuário. O arquivo é MP4 progressivo, 720p, com duas faixas de áudio
// e a portuguesa marcada como padrão.
//
// Técnica validada em 07/10/2026: leitura da página + medição do arquivo.

const axios = require('axios');

const BASE = 'https://pipocacine.lat';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VALIDADE = 6 * 60 * 60 * 1000; // o endereço do arquivo vale por horas
const cache = new Map();

async function resolverFilme(tmdbId) {
    const chave = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(chave)) return null;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;

    let pagina;
    try {
        pagina = await axios.get(`${BASE}/embed/${chave}`, {
            headers: {
                'User-Agent': UA,
                'Accept-Language': 'pt-BR,pt;q=0.9',
                Referer: `${BASE}/`,
                Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
            },
            timeout: 15000,
            responseType: 'text',
            maxContentLength: 4 * 1024 * 1024
        });
    } catch {
        return null;
    }

    const bloco = String(pagina.data || '').match(/var\s+videoSources\s*=\s*(\[[^\]]*\])/);
    if (!bloco) return null;
    const url = escolherFonte(bloco[1], BASE);
    if (!url) return null;
    // Só aceita endereço do próprio provedor.
    if (!/^https:\/\/pipocacine\.lat\//i.test(url)) return null;

    const dados = {
        url,
        audio: 'pt-BR',
        fonte: 'PipocaCine',
        resolucao: '720p',
        type: 'file'
    };
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

// Escolhe o endereço dublado dentro do bloco de fontes da página.
function escolherFonte(blocoJson, base = BASE) {
    let fontes = [];
    try {
        fontes = JSON.parse(String(blocoJson).replace(/\\\//g, '/'));
    } catch {
        return null;
    }
    if (!Array.isArray(fontes) || !fontes.length) return null;
    const escolhida = fontes.find(f => /dub/i.test(String(f && f.label || ''))) || fontes[0];
    if (!escolhida || !escolhida.src) return null;
    try {
        return new URL(escolhida.src, base).href;
    } catch {
        return null;
    }
}

module.exports = { resolverFilme, escolherFonte, BASE };
