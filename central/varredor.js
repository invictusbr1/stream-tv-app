'use strict';
// Varredor de fornecedores da central.
//
// Procura candidatos em três lugares:
//   1. Addons públicos do Stremio (entregam JSON com o endereço do vídeo);
//   2. GitHub — projetos de embed/streaming que citam provedores;
//   3. O código dos sites agregadores (o app.js costuma listar os players).
//
// O resultado entra na lista de candidatas do caçador, que testa cada um com
// medição de verdade (reprodução + idioma).

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TEMPO = 20000;

// Redes de anúncio conhecidas. Se o site carrega qualquer uma delas, a regra
// "sem anúncio" do projeto não é atendida — e isso precisa contar na nota.
const REDES_DE_ANUNCIO = [
    'propellerads', 'propeller', 'popads', 'popcash', 'adsterra', 'exoclick', 'exosrv', 'juicyads',
    'clickadu', 'hilltopads', 'monetag', 'adcash', 'onclck', 'onclickads', 'adnium', 'trafficjunky',
    'highperformanceformat', 'googlesyndication', 'doubleclick', 'adservice', 'adsystem',
    'mgid', 'revcontent', 'taboola', 'outbrain', 'criteo', 'pubmatic', 'rubiconproject',
    'smartadserver', 'adform', 'loopme', 'inmobi', 'applovin', 'unityads', 'vungle',
    'popunder', 'popunderjs', 'popup-domination', 'linkvertise', 'shortest',
];

function sinaisDeAnuncio(texto) {
    const bruto = String(texto || '');
    const alvo = bruto.toLowerCase();
    const achados = new Set();
    for (const rede of REDES_DE_ANUNCIO) {
        if (alvo.includes(rede)) achados.add(rede);
    }
    if (/window\.open\s*\(/.test(bruto) && /(pop|anunci|ads?|click)/i.test(bruto)) achados.add('popup automático');
    if (/<iframe[^>]+(ads?|banner|pop)/i.test(bruto)) achados.add('iframe de anúncio');
    return [...achados];
}

// Addons do Stremio com streams (endereço público, sem cadastro).
const ADDONS = [
    { nome: 'FenixFlix (FenixHub)', base: 'https://fenixflix.fenixhub.online' },
    { nome: 'Zeus (Baby Beamup)', base: 'https://398fe185fed6-zeus.baby-beamup.club/v1-p2yn-q3j-a3-mb' },
    // Bases públicas que aparecem nas listas da comunidade. Cada uma é testada
    // com títulos reais antes de virar fonte — e vira FICHA quando funciona.
    { nome: 'Cinemeta (metadados)', base: 'https://v3-cinemeta.strem.io' },
    { nome: 'OpenSubtitles (legendas)', base: 'https://opensubtitles-v3.strem.io' },
];

// Títulos de teste para os addons (códigos IMDb).
const AMOSTRAS_ADDON = [
    { tipo: 'movie', id: 'tt0352248', titulo: 'A Luta pela Esperança' },
    { tipo: 'series', id: 'tt0903747:1:1', titulo: 'Breaking Bad 1x1' },
    { tipo: 'movie', id: 'tt31192372', titulo: 'A Queda 2' },
    // Títulos muito comuns nas listas dubladas: servem de amostra para medir o
    // addon e, depois, para VALIDAR a ficha em títulos que ele realmente tem.
    { tipo: 'movie', id: 'tt0111161', titulo: 'Um Sonho de Liberdade' },
    { tipo: 'movie', id: 'tt1375666', titulo: 'A Origem' },
    { tipo: 'movie', id: 'tt0468569', titulo: 'Batman: O Cavaleiro das Trevas' },
    { tipo: 'series', id: 'tt0944947:1:1', titulo: 'Game of Thrones 1x1' },
    { tipo: 'series', id: 'tt4574334:1:1', titulo: 'Stranger Things 1x1' },
];

// Sites agregadores para ler o código e descobrir quais players usam.
const SITES = [
    { nome: 'BRFlix', url: 'https://brflix.lat/' },
    { nome: 'BetterFlix', url: 'https://betterflix.lol/' },
    { nome: 'PinguimCinema', url: 'https://pinguimcinema.space/' },
    { nome: 'SuperFlix', url: 'https://superflixapi.monster/' },
    { nome: 'StreamBetter', url: 'https://streambetter.shop/' },
    { nome: 'RedeCanais', url: 'https://redecanais20.lat/' },
    { nome: 'PobreFlix', url: 'https://pobreflixhd.sbs/' },
];

function comPrazo(promessa, ms = TEMPO) {
    return Promise.race([promessa, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
}

function marcasDeDublado(texto) {
    return /dublado|dual[ -]?áudio|dual[ -]?audio|🇧🇷|pt-?br|portugu/i.test(String(texto || ''));
}

// Hosts dos agregadores que o caçador já conhece (das categorias do caçador):
// entram na leitura do mapa do site, porque é neles que os títulos ficam.
// Assim o caçador descobre o MOLDE do endereço e consegue medir de verdade.
function dominiosConhecidos() {
    try {
        const categorias = require('./cacador').CATEGORIAS || [];
        const hosts = [];
        for (const categoria of categorias) {
            for (const candidata of categoria.candidatas || []) {
                try { hosts.push(new URL(candidata.url).hostname.replace(/^www\./, '')); } catch { /* sem url */ }
            }
        }
        return hosts;
    } catch { return []; }
}

// ---------------------------------------------------------------- addons
async function varrerAddons(registrar = () => {}) {
    const achados = [];
    // Os links de cada filme de teste são só exemplos (valem uma vez). O que
    // interessa é o ENDEREÇO DO ADDON, porque dele sai o molde que serve para
    // qualquer título — por isso ele vem PRIMEIRO na lista de candidatas.
    const endpoints = [];
    // Um candidato por addon E por tipo (filme/série), com a lista dos títulos
    // em que aquele addon realmente devolveu vídeo — é o que valida a ficha.
    const porAddon = new Map();
    for (const addon of ADDONS) {
        for (const amostra of AMOSTRAS_ADDON) {
            const caminho = amostra.tipo === 'movie' ? `/stream/movie/${amostra.id}.json` : `/stream/series/${amostra.id}.json`;
            const resposta = await comPrazo(axios.get(addon.base + caminho, { headers: { 'User-Agent': UA }, timeout: 15000, validateStatus: s => s < 500 }).catch(() => null));
            const streams = resposta && resposta.data && Array.isArray(resposta.data.streams) ? resposta.data.streams : [];
            if (!streams.length) continue;
            const chave = `${addon.base}|${amostra.tipo}`;
            const registro = porAddon.get(chave) || { addon, tipo: amostra.tipo, confirmados: [], primeira: amostra, dublado: false };
            if (!registro.confirmados.includes(amostra.id)) registro.confirmados.push(amostra.id);
            for (const stream of streams.slice(0, 3)) {
                if (!stream.url) continue;
                achados.push({
                    nome: `${addon.nome} · ${(stream.name || 'stream')}`,
                    url: stream.url,
                    origem: 'addon do Stremio',
                    tituloTeste: amostra.titulo,
                    addonBase: addon.base,
                    addonNome: addon.nome,
                    detalhes: { imdb: amostra.id.split(':')[0], tipo: amostra.tipo },
                    dublado: marcasDeDublado(`${stream.title || ''} ${stream.name || ''}`),
                    motivoEsperado: (stream.title || '').replace(/\n/g, ' ').slice(0, 80) || 'stream de addon público',
                });
                if (marcasDeDublado(`${stream.title || ''} ${stream.name || ''}`)) registro.dublado = true;
            }
            porAddon.set(chave, registro);
        }
        registrar(`addon ${addon.nome}: ${achados.filter(a => a.nome.startsWith(addon.nome)).length} stream(s)`);
    }
    // Candidato do próprio addon (é dele que sai a ficha, não o link do filme).
    for (const registro of porAddon.values()) {
        const caminho = registro.tipo === 'movie'
            ? `/stream/movie/${registro.primeira.id}.json`
            : `/stream/series/${registro.primeira.id}.json`;
        endpoints.push({
            nome: registro.addon.nome,
            url: registro.addon.base + caminho,
            origem: 'addon do Stremio',
            tituloTeste: registro.primeira.titulo,
            detalhes: {
                imdb: registro.primeira.id.split(':')[0],
                tipo: registro.tipo,
                confirmados: registro.confirmados,
            },
            dublado: registro.dublado,
            motivoEsperado: `o addon entrega vídeo em ${registro.confirmados.length} título(s) testado(s)`,
        });
    }
    return [...endpoints, ...achados];
}

// ---------------------------------------------------------------- mapa do site
// Todo agregador publica um mapa dos seus endereços (sitemap.xml). Desse mapa
// sai o MOLDE de como o site pede um título — e com um título real na mão o
// caçador consegue medir a fonte de verdade (foi assim que o mapa de um
// fornecedor revelou 15.600 endereços).
const PALAVRAS_DE_TITULO = /(filme|filmes|movie|movies|serie|series|tv|watch|assistir|ver|embed|player|anime|dorama)/i;

function moldeDoEndereco(url) {
    let texto = String(url || '').split('?')[0].split('#')[0];
    if (!PALAVRAS_DE_TITULO.test(texto)) return '';
    texto = texto.replace(/\/(\d{3,9})\/(\d{1,3})\/(\d{1,3})(?=\/|$)/, '/{id}/{temporada}/{episodio}');
    if (!/\{id\}/.test(texto)) texto = texto.replace(/\/(\d{3,9})(?=\/|$)/, '/{id}');
    return /\{id\}/.test(texto) ? texto : '';
}

async function varrerSitemaps(dominios = [], registrar = () => {}) {
    const achados = [];
    for (const dominio of dominios.slice(0, 8)) {
        try {
            const raiz = `https://${dominio.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
            const primeiro = await comPrazo(axios.get(`${raiz}/sitemap.xml`, { headers: { 'User-Agent': UA }, timeout: 15000, responseType: 'text', maxRedirects: 4, validateStatus: s => s < 500 }).catch(() => null), 16000);
            let xml = String((primeiro && primeiro.data) || '');
            if (!/<urlset|<sitemapindex/i.test(xml)) continue;
            // Mapa de mapas: entra nos primeiros filhos.
            if (/<sitemapindex/i.test(xml)) {
                const filhos = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).slice(0, 3);
                const partes = [];
                for (const filho of filhos) {
                    const resposta = await comPrazo(axios.get(filho, { headers: { 'User-Agent': UA }, timeout: 15000, responseType: 'text', maxRedirects: 3, validateStatus: s => s < 500 }).catch(() => null), 16000);
                    if (resposta && resposta.data) partes.push(String(resposta.data));
                }
                xml = partes.join('\n') || xml;
            }
            const enderecos = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).slice(0, 4000);
            const moldes = new Set();
            for (const endereco of enderecos) {
                const molde = moldeDoEndereco(endereco);
                if (molde) moldes.add(molde);
                if (moldes.size >= 3) break;
            }
            for (const molde of moldes) {
                achados.push({
                    nome: `${dominio} (mapa do site)`,
                    url: molde.replace('{id}', '27205').replace('{temporada}', '1').replace('{episodio}', '1'),
                    molde,
                    origem: 'mapa do site',
                    motivoEsperado: `o site publica o endereço dos títulos (${molde})`,
                });
            }
            if (moldes.size) registrar(`${dominio}: mapa do site revelou ${moldes.size} molde(s) de endereço`);
        } catch { /* tenta o próximo domínio */ }
    }
    return achados;
}

// ---------------------------------------------------------------- GitHub
async function varrerGithub(token = '', registrar = () => {}) {
    const consultas = [
        'stremio addon portuguese streams',
        'stremio addon dublado',
        'embed api filmes series streaming',
        'assistir filmes dublados api',
        'embed providers brasileiro streaming',
        'streaming api dublado portugues embed',
        'iptv brasil lista m3u atualizada',
        'filmes online dublado catalog',
        'site filmes dublados player',
    ];
    const achados = [];
    for (const termo of consultas) {
        try {
            const resposta = await axios.get('https://api.github.com/search/repositories', {
                params: { q: termo, sort: 'stars', per_page: 6 },
                headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
                timeout: 20000, validateStatus: s => s < 500,
            });
            for (const repo of (resposta.data.items || [])) {
                const texto = `${repo.name} ${repo.description || ''} ${repo.homepage || ''}`;
                achados.push({
                    nome: repo.full_name,
                    url: repo.homepage || repo.html_url,
                    origem: 'GitHub',
                    estrelas: repo.stargazers_count,
                    motivoEsperado: (repo.description || '').slice(0, 100),
                    dublado: marcasDeDublado(texto),
                });
            }
            registrar(`GitHub "${termo}": ${(resposta.data.items || []).length} projeto(s)`);
        } catch (erro) { registrar('GitHub falhou: ' + String(erro.message).slice(0, 60)); }
    }
    // Remove repetidos mantendo a ordem por estrelas.
    const vistos = new Set();
    return achados.filter(item => !vistos.has(item.url) && vistos.add(item.url)).sort((a, b) => (b.estrelas || 0) - (a.estrelas || 0)).slice(0, 10);
}

// ---------------------------------------------------------------- código dos sites
const DOMINIOS_CONHECIDOS = /(google|gstatic|cloudflare|jsdelivr|unpkg|tailwind|github|tmdb|themoviedb|fontawesome|bootstrap|jquery|gstatic|w3\.org|schema|facebook|twitter|whatsapp|disqus|chatango|histats|doubleclick|adservice)/i;

// ---------------------------------------------------------------- código aberto
// Projetos públicos mantêm listas de provedores de embed/streaming. Com o token
// do GitHub a busca de CÓDIGO funciona e rende candidatos que ninguém digitou
// na mão — é a diferença entre "testar o que já conhecemos" e "descobrir".
function extrairDominios(texto) {
    const achados = new Set();
    for (const m of String(texto || '').matchAll(/https?:\\?\/\\?\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const dominio = m[1].toLowerCase().replace(/^www\./, '');
        if (DOMINIOS_CONHECIDOS.test(dominio)) continue;
        if (!/\./.test(dominio)) continue;
        achados.add(dominio);
    }
    return [...achados];
}

async function varrerCodigoGithub(token = '', registrar = () => {}) {
    if (!token) return [];
    const consultas = [
        '"vidsrc" "embed" extension:json',
        '"embed" "m3u8" "dublado" extension:json',
        '"embedProviders" OR "embed_providers" extension:js',
        '"embed/movie/" language:JavaScript',
        '"embed/tv/" language:JavaScript',
        '"m3u8" "tmdb" language:JavaScript',
        '"file" "m3u8" language:PHP',
        '"stream/movie/tt" extension:js',
        '"manifest.json" "catalogs" "streams" extension:js',
    ];
    const achados = [];
    for (const termo of consultas) {
        try {
            const busca = await axios.get('https://api.github.com/search/code', {
                params: { q: termo, per_page: 5 },
                headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
                timeout: 25000, validateStatus: s => s < 500,
            });
            const itens = (busca.data && busca.data.items) || [];
            registrar(`GitHub (código) "${termo}": ${itens.length} arquivo(s)`);
            for (const item of itens.slice(0, 3)) {
                const repositorio = item.repository || {};
                const bruto = `https://raw.githubusercontent.com/${repositorio.full_name}/${repositorio.default_branch || 'main'}/${item.path}`;
                const conteudo = await axios.get(bruto, { headers: { 'User-Agent': UA }, timeout: 20000, responseType: 'text', validateStatus: s => s < 500 }).catch(() => null);
                if (!conteudo || typeof conteudo.data !== 'string') continue;
                for (const dominio of extrairDominios(conteudo.data).slice(0, 4)) {
                    achados.push({
                        nome: `listado em ${repositorio.full_name || 'projeto'}`,
                        url: `https://${dominio}/`,
                        origem: 'lista pública no GitHub',
                        motivoEsperado: `domínio citado em ${item.path}`,
                        anuncios: sinaisDeAnuncio(conteudo.data),
                    });
                }
            }
        } catch (erro) { registrar('GitHub (código) falhou: ' + String(erro.message).slice(0, 60)); }
    }
    const vistos = new Set();
    return achados.filter(item => !vistos.has(item.url) && vistos.add(item.url)).slice(0, 25);
}

async function varrerSites(registrar = () => {}) {
    const achados = [];
    for (const site of SITES) {
        try {
            const pagina = await comPrazo(axios.get(site.url, { headers: { 'User-Agent': UA }, timeout: 15000, responseType: 'text', maxRedirects: 4, validateStatus: s => s < 500 }));
            const html = String((pagina && pagina.data) || '');
            const scripts = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 8))];
            const textos = [html];
            for (const src of scripts) {
                const endereco = src.startsWith('http') ? src : new URL(src, site.url).href;
                const arquivo = await comPrazo(axios.get(endereco, { headers: { 'User-Agent': UA, Referer: site.url }, timeout: 15000, responseType: 'text', maxRedirects: 3, validateStatus: s => s < 500 }).catch(() => null), 15000);
                if (arquivo && arquivo.data) textos.push(String(arquivo.data));
            }
            const juntos = textos.join('\n');
            const dominios = [...new Set([...juntos.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\//gi)].map(m => m[1].toLowerCase()))]
                .filter(dominio => !DOMINIOS_CONHECIDOS.test(dominio) && !dominio.includes(site.nome.toLowerCase().replace(/\s/g, '')));
            for (const dominio of dominios.slice(0, 8)) achados.push({
                nome: `${site.nome} usa ${dominio}`,
                url: `https://${dominio}/`,
                origem: 'código do site',
                siteBase: site.nome,
                motivoEsperado: 'endereço de player citado no código do site',
                // Já vai marcado quando o site de origem carrega rede de anúncio.
                anuncios: sinaisDeAnuncio(juntos),
            });
            registrar(`${site.nome}: ${dominios.length} domínio(s) de terceiros no código`);
        } catch (erro) {
            registrar(`${site.nome} falhou: ${String(erro.message).slice(0, 50)}`);
        }
    }
    return achados;
}

async function varrerTudo({ token = '', registrar = () => {} } = {}) {
    const [addons, github, codigo, sites] = await Promise.all([
        varrerAddons(registrar).catch(() => []),
        varrerGithub(token, registrar).catch(() => []),
        varrerCodigoGithub(token, registrar).catch(() => []),
        varrerSites(registrar).catch(() => []),
    ]);
    // Com os domínios já descobertos, o mapa do site (sitemap.xml) revela o
    // MOLDE do endereço de cada título — é assim que uma página desconhecida
    // vira uma ficha de fonte testável com títulos de verdade.
    // Domínios para o mapa do site: os que apareceram nas descobertas MAIS os
    // próprios sites agregadores conhecidos (é neles que os títulos ficam).
    const dominios = [...new Set([
        ...SITES.map(site => { try { return new URL(site.url).hostname.replace(/^www\./, ''); } catch { return ''; } }),
        ...codigo.map(item => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; } }),
        ...sites.map(item => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; } }),
        ...dominiosConhecidos(),
    ].filter(Boolean))]
        .filter(dominio => !DOMINIOS_CONHECIDOS.test(dominio));
    const sitemaps = await varrerSitemaps(dominios, registrar).catch(() => []);
    return [...addons, ...github, ...codigo, ...sites, ...sitemaps];
}

module.exports = { varrerTudo, varrerAddons, varrerGithub, varrerCodigoGithub, varrerSites, varrerSitemaps, moldeDoEndereco, marcasDeDublado, sinaisDeAnuncio, extrairDominios, REDES_DE_ANUNCIO, ADDONS, SITES };
