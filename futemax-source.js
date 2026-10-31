'use strict';
// Fonte ao vivo do Futemax (futemax.ltda).
//
// Como o site funciona (medido em 29/10/2026, jogo Vasco × Flamengo):
//   - a página do jogo não tem player: ela lista botões "Opção 1..6", cada um
//     apontando para um embed de terceiro (nphd.online, futfut.embedtv.cc,
//     dunbel.net, esportesembed.org...);
//   - a opção do futfut.embedtv.cc publica a lista HLS pronta no próprio HTML
//     (`const src = "https://….lat/stream/<hash>/error.txt"`), com nome de
//     arquivo .txt e segmentos .png servidos como image/png — disfarce contra
//     quem copia o endereço; o conteúdo é MPEG-TS de verdade;
//   - nphd.online exige Cloudflare Turnstile (captcha), então é descartado:
//     não há como resolver sem interação humana.
//
// Este módulo só LÊ o HTML publicado e devolve a lista que o aplicativo toca
// no próprio player. Nenhum script do fornecedor é executado, nenhuma página
// com anúncio é aberta.

// O CDN do fornecedor usa subdomínio "<hash>.s25-cloudfront-net.lat"; a
// regra aceita o sufixo e não abre a porta para outros domínios parecidos.
const HOSTS_PERMITIDOS = [/(^|\.)embedtv\.cc$/i, /cloudfront-net\.lat$/i];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function enderecoSeguro(texto) {
    try {
        const url = new URL(String(texto));
        if (url.protocol !== 'https:') return null;
        if (url.username || url.password) return null;
        if (url.port && url.port !== '443') return null;
        if (!HOSTS_PERMITIDOS.some(regra => regra.test(url.hostname))) return null;
        return url.href;
    } catch { return null; }
}

// Página do jogo -> lista de embeds publicados nos botões "Opção N".
function embedsDaPagina(html) {
    const achados = [];
    const vistos = new Set();
    for (const m of String(html || '').matchAll(/data-src=["']([^"']+)["']/gi)) {
        const bruto = m[1].replace(/&#0?38;/g, '&').replace(/&amp;/g, '&');
        if (!/^https:\/\//i.test(bruto)) continue;
        let url;
        try { url = new URL(bruto); } catch { continue; }
        if (/(^|\.)google\.com$/i.test(url.hostname)) continue; // botão de busca, não é transmissão
        if (vistos.has(url.href)) continue;
        vistos.add(url.href);
        achados.push(url.href);
    }
    return achados;
}

// HTML do embed -> endereço da lista HLS publicada nele.
function listaDoEmbed(html) {
    const texto = String(html || '');
    const achados = [];
    for (const m of texto.matchAll(/const\s+src\s*=\s*["']([^"']+)["']/g)) achados.push(m[1]);
    for (const m of texto.matchAll(/["'](https:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/g)) achados.push(m[1]);
    // O manifesto também aparece disfarçado (error.txt, playlist.txt…).
    for (const m of texto.matchAll(/["'](https:\/\/[^"'\s/]+\/stream\/[^"'\s]+)["']/g)) achados.push(m[1]);
    for (const bruto of achados) {
        const url = enderecoSeguro(bruto);
        if (url) return url;
    }
    return null;
}

function pareceListaHls(texto) {
    const limpo = String(texto || '').trimStart();
    return limpo.startsWith('#EXTM3U') && /#EXTINF:/.test(limpo);
}

// Percorre as opções até achar uma que entregue lista HLS de verdade.
// `get(url, referer)` devolve o texto da resposta.
async function resolve(urlJogo, get) {
    const pagina = new URL(String(urlJogo));
    if (pagina.protocol !== 'https:' || !/(^|\.)futemax\.(ltda|online|tv)$/i.test(pagina.hostname)) {
        throw Error('Endereço do Futemax inválido');
    }
    const html = String(await get(pagina.href, pagina.href));
    const embeds = embedsDaPagina(html);
    if (!embeds.length) throw Error('A página do jogo não publicou transmissões');

    const tentativas = [];
    for (const embed of embeds) {
        try {
            const paginaEmbed = String(await get(embed, embed));
            const lista = listaDoEmbed(paginaEmbed);
            if (!lista) { tentativas.push(embed + ' (sem lista)'); continue; }
            const texto = String(await get(lista, embed));
            if (!pareceListaHls(texto)) { tentativas.push(embed + ' (não é HLS)'); continue; }
            return {
                url: lista,
                referer: embed,
                type: 'hls',
                live: true,
                audio: 'fonte',
                source: 'Futemax · ao vivo',
                fonteId: 'futemax',
                embedOrigem: embed,
            };
        } catch (erro) {
            tentativas.push(embed + ' (' + erro.message + ')');
        }
    }
    throw Error('Nenhuma transmissão abriu sem anúncio: ' + tentativas.join(', '));
}

// Página inicial -> jogos publicados (o formulário do endereço é estável:
// "<time-a>-x-<time-b>-ao-vivo-<dd-mm-aaaa>"). Usado para montar a lista
// "Ao vivo agora" dentro do aplicativo.
function jogosDoDia(html) {
    const vistos = new Set();
    const jogos = [];
    for (const m of String(html || '').matchAll(/https:\/\/futemax\.(?:ltda|online|tv)\/[a-z0-9-]+-ao-vivo-(\d{2})-(\d{2})-(\d{4})\/?/gi)) {
        const url = m[0].endsWith('/') ? m[0] : m[0] + '/';
        if (vistos.has(url)) continue;
        vistos.add(url);
        const slug = url.replace(/^https:\/\/[^/]+\//, '').replace(/-ao-vivo-.*$/, '');
        const titulo = slug.split('-x-').map(parte => parte.split('-').map(p => p.length > 2 ? p[0].toUpperCase() + p.slice(1) : p.toUpperCase()).join(' ')).join(' x ');
        jogos.push({ url, titulo, data: `${m[3]}-${m[2]}-${m[1]}` });
    }
    return jogos;
}

module.exports = { UA, enderecoSeguro, embedsDaPagina, listaDoEmbed, pareceListaHls, resolve, jogosDoDia, HOSTS_PERMITIDOS };
