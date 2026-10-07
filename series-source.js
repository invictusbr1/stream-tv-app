// Resolvedor de episódios: procura a melhor opção que funciona sem depender
// do usuário escolher nada e sem abrir páginas de terceiros.
//
// Ordem de preferência (igual à regra do aplicativo):
//   1. fonte dublada e limpa (WatchPlay, quando existe sessão);
//   2. fonte limpa em alta definição, com legenda em português quando houver.
//
// Tudo é devolvido pelo próprio aplicativo (/api/hls), então o player nunca
// precisa falar direto com o provedor e nenhum anúncio entra no caminho.

const TEMPO = 12000;
const VALIDADE_CACHE = 10 * 60 * 1000;
const cache = new Map();

async function comPrazo(promessa, ms) {
    let relogio;
    try {
        return await Promise.race([
            promessa,
            new Promise(resolve => { relogio = setTimeout(() => resolve(null), ms); })
        ]);
    } finally {
        clearTimeout(relogio);
    }
}

// 1) Fonte dublada e limpa (mesma dos filmes). Exige sessão configurada.
async function tentarDublada(tmdbId, temporada, episodio, cookie) {
    try {
        const axios = require('axios');
        const r = await comPrazo(axios.get(`https://v2.watchplay.shop/serie/${tmdbId}/${temporada}/${episodio}`, {
            timeout: TEMPO,
            maxRedirects: 0,
            maxContentLength: 1024 * 1024,
            responseType: 'text',
            validateStatus: status => status === 200,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                ...(cookie ? { Cookie: cookie } : {})
            }
        }), TEMPO + 1500);
        if (!r) return null;
        const dados = require('./playback-source').parseWatchPlay(r.data);
        return {
            url: dados.url,
            audio: 'pt-BR',
            fonte: 'Dublado (fonte limpa)',
            resolucao: '720p',
            legendas: []
        };
    } catch {
        return null;
    }
}

// 2) Fonte limpa em alta definição, com as legendas que ela oferece.
async function tentarAltaDefinicao(tmdbId, temporada, episodio) {
    try {
        const dados = await comPrazo(require('./vixsrc-source').resolver(tmdbId, 'tv', temporada, episodio), TEMPO);
        if (!dados || !dados.url) return null;
        const legendas = Array.isArray(dados.legendas) ? dados.legendas : [];
        return {
            url: dados.url,
            audio: 'original',
            fonte: 'Alta definição',
            resolucao: dados.qualidade || '',
            legendas,
            legendaPortugues: legendas.some(nome => /portugu|brazil|brasil/i.test(String(nome)))
        };
    } catch {
        return null;
    }
}

// Devolve sempre o endereço pelo aplicativo, com o referer certo de cada fonte.
function prepararParaPlayer(escolhido) {
    const midia = require('./midia-proxy');
    let referer = '';
    try { referer = midia.refererPadrao(new URL(escolhido.url).hostname); } catch { /* sem referer */ }
    return { ...escolhido, urlAplicativo: midia.urlViaProxy(escolhido.url, referer) };
}

async function resolverEpisodio({ tmdbId, temporada, episodio, cookie = '' }) {
    const chave = `${tmdbId}:${temporada}:${episodio}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;

    let escolhido = await dependencias.tentarDublada(tmdbId, temporada, episodio, cookie);
    if (!escolhido) escolhido = await dependencias.tentarAltaDefinicao(tmdbId, temporada, episodio);
    const pronto = escolhido ? prepararParaPlayer(escolhido) : null;

    // Só guarda o que deu certo: assim a próxima tentativa busca de novo.
    if (pronto) cache.set(chave, { valor: pronto, expira: Date.now() + VALIDADE_CACHE });
    return pronto;
}

// Pontos de troca usados pelos testes (mantêm a ordem da regra do aplicativo).
const dependencias = { tentarDublada, tentarAltaDefinicao };

function definirDependenciasParaTeste(novas = {}) {
    if (novas.tentarDublada) dependencias.tentarDublada = novas.tentarDublada;
    if (novas.tentarAltaDefinicao) dependencias.tentarAltaDefinicao = novas.tentarAltaDefinicao;
    if (novas.limparCache) cache.clear();
}

module.exports = { resolverEpisodio, definirDependenciasParaTeste };
