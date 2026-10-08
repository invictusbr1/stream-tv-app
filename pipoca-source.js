// Fonte dublada limpa para filmes (PipocaCine).
//
// O endereço do filme é publicado na própria página do provedor, mas o vídeo
// toca DENTRO do aplicativo: a página (com os anúncios dela) nunca é aberta
// para o usuário. O arquivo é MP4 progressivo, 720p, com duas faixas de áudio
// e a portuguesa marcada como padrão.
//
// Também cobre SÉRIE: o site publica a lista de episódios (SEASONS_DATA) com o
// endereço dublado de cada um, em MP4 720p com áudio em português — medido em
// 07/10/2026 (voz em português confirmada no arquivo, sem anúncio no caminho).
//
// Técnica validada em 07/10/2026: leitura da página + medição do arquivo.

const axios = require('axios');

const BASE = 'https://pipocacine.lat';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// O endereço do arquivo é assinado e expira: medido em 08/10/2026 — depois de
// algum tempo o servidor responde 410 (expirado). Por isso a memória é curta.
const VALIDADE = 15 * 60 * 1000;
const cache = new Map();

const CABECALHOS = {
    'User-Agent': UA,
    'Accept-Language': 'pt-BR,pt;q=0.9',
    Referer: `${BASE}/`,
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
};

async function resolverFilme(tmdbId) {
    const chave = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(chave)) return null;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;

    let pagina;
    try {
        pagina = await axios.get(`${BASE}/embed/${chave}`, { headers: CABECALHOS, timeout: 15000, responseType: 'text', maxContentLength: 4 * 1024 * 1024 });
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
        type: 'file',
        // O motor usa este número para não guardar um endereço vencido.
        validadeMs: VALIDADE
    };
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

// Episódio dublado: a página da série lista os episódios com o endereço de cada
// um. Só aceitamos o endereço marcado como DUBLADO (url_dub) do provedor de
// vídeo do próprio site — nada de link de terceiros.
async function resolverEpisodio(tmdbId, temporada, episodio) {
    const id = String(tmdbId || '').trim();
    const t = String(temporada || '').trim();
    const e = String(episodio || '').trim();
    if (!/^\d{1,10}$/.test(id) || !/^\d{1,3}$/.test(t) || !/^[1-9]\d{0,3}$/.test(e)) return null;
    const chave = `tv:${id}:${t}:${e}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.valor;

    let pagina;
    try {
        pagina = await axios.get(`${BASE}/media/tv?id=${id}&s=${t}&e=${e}`, { headers: CABECALHOS, timeout: 15000, responseType: 'text', maxContentLength: 4 * 1024 * 1024 });
    } catch {
        return null;
    }

    const bloco = String(pagina.data || '').match(/var\s+SEASONS_DATA\s*=\s*(\{[\s\S]*?\});/);
    if (!bloco) return null;
    const url = escolherEpisodio(bloco[1], t, e);
    if (!url) return null;

    const dados = { url, audio: 'pt-BR', fonte: 'PipocaCine · dublado', resolucao: '720p', type: 'file' };
    cache.set(chave, { valor: dados, expira: Date.now() + VALIDADE });
    return dados;
}

// Procura o endereço dublado do episódio dentro do bloco de episódios.
function escolherEpisodio(blocoJson, temporada, episodio) {
    let dados;
    try {
        dados = JSON.parse(String(blocoJson));
    } catch {
        return null;
    }
    if (!dados || typeof dados !== 'object') return null;
    const temporadaDados = dados[String(Number(temporada))] || dados[String(temporada)];
    const episodios = temporadaDados && temporadaDados.episodes;
    if (!episodios || typeof episodios !== 'object') return null;
    const alvo = episodios[String(Number(episodio))] || episodios[String(episodio)];
    const url = alvo && (alvo.url_dub || alvo.urlDublado);
    if (!url) return null;
    // Só o endereço de vídeo do provedor do próprio site, em formato previsível.
    if (!/^https:\/\/nixplay\.lat\/series\/[a-z0-9-]+\/[A-Za-z0-9_-]+\/\d{1,10}\/\d{1,3}\/\d{1,4}\.mp4$/i.test(String(url))) return null;
    return String(url);
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
    // Só aceita a opção que o próprio provedor rotula como dublada ("HD DUB").
    // O arquivo dessa opção tem a faixa em português marcada como padrão —
    // conferido com medição (faixa "por" com DISPOSITION:default=1). Sem o
    // rótulo, é preferível deixar o motor seguir para outra fonte a entregar
    // um arquivo que pode estar no idioma original.
    const escolhida = fontes.find(f => /dub/i.test(String(f && f.label || '')));
    if (!escolhida || !escolhida.src) return null;
    try {
        return new URL(escolhida.src, base).href;
    } catch {
        return null;
    }
}

module.exports = { resolverFilme, resolverEpisodio, escolherFonte, escolherEpisodio, BASE };
