'use strict';
// Vetores de descoberta — os "caminhos invisíveis" por onde o caçador acha
// fornecedor sem depender de lista pronta.
//
// Cada vetor devolve CANDIDATAS no mesmo formato do varredor (nome, url,
// origem, motivoEsperado). Nada aqui abre página de terceiro para o usuário:
// tudo é leitura no servidor, medida antes de virar fonte.
//
// Medido em 10/10/2026 (o que funciona desta máquina):
//   - Wayback/CDX: OK — revela o formato de endereço dos títulos dos sites
//     (ex.: pobreflixhd.sbs/filme/... com o slug do título) e domínios antigos;
//   - Telegram (pré-visualização pública): OK — pega domínios citados em canais;
//   - GitHub (código e repositórios): OK — já usado pelo varredor;
//   - Common Crawl e crt.sh: fora do ar/bloqueados no momento da medição —
//     ficam implementados e voltam sozinhos quando responderem.

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TEMPO = 30000;

// Canais públicos do Telegram com filmes/séries dublados (pré-visualização web,
// sem login). Novos canais entram aqui sem quebrar nada.
const CANAIS_TELEGRAM = ['filmes', 'filmeseseries', 'SeriesDubladas', 'animesbr'];

// Palavras que aparecem no endereço de um título nos agregadores.
const PALAVRAS_DE_TITULO = /(filme|filmes|movie|movies|serie|series|assistir|watch|ver|online|dublado|legendado|anime|dorama)/i;

function comPrazo(promessa, ms = TEMPO) {
    return Promise.race([promessa, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
}

async function textoDe(url, opcoes = {}) {
    const resposta = await comPrazo(axios.get(url, {
        timeout: 25000, responseType: 'text', maxRedirects: 5, maxContentLength: 6 * 1024 * 1024,
        validateStatus: s => s < 500, headers: { 'User-Agent': UA, ...(opcoes.headers || {}) },
    }));
    return resposta && typeof resposta.data === 'string' ? resposta.data : '';
}

// ------------------------------------------------------------------ wayback
// O arquivo da internet guarda o endereço de páginas que já existiram. Dele
// saem dois presentes: o FORMATO do endereço de cada título (mesmo com palavras
// no meio, tipo /filmes/online/o-uivo-dublado-37835) e domínios antigos do
// mesmo site (que às vezes voltam com outro final).
async function varrerWayback(dominios = [], registrar = () => {}) {
    const achados = [];
    for (const dominio of dominios.slice(0, 6)) {
        // Busca só os caminhos que parecem título (o arquivo da internet tem
        // milhões de linhas por domínio; filtrar aqui deixa a resposta pequena).
        const base = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(dominio)}&matchType=domain&filter=urlkey:.*(filme|filmes|movie|serie|series|assistir|online|dublado).*&output=json&limit=300&collapse=urlkey`;
        let linhas = [];
        try {
            const texto = await textoDe(base, { headers: { Accept: 'application/json' } });
            if (!texto || texto.trim() === '[]') continue;
            const dados = JSON.parse(texto);
            // A primeira linha é o cabeçalho (urlkey, timestamp, original, …).
            linhas = dados.slice(1).map(linha => String((Array.isArray(linha) ? linha[2] : linha) || ''));
        } catch { continue; }
        const vistos = new Set();
        for (const endereco of linhas) {
            if (!/^https?:/i.test(endereco) || !PALAVRAS_DE_TITULO.test(endereco)) continue;
            const molde = endereco
                .replace(/^http:/i, 'https:')
                .replace(/(\d{2,9})(?=\/|$)/, '{id}')
                .split('?')[0];
            if (!/\{id\}/.test(molde) || vistos.has(molde)) continue;
            vistos.add(molde);
            achados.push({
                nome: `${dominio} (arquivo da internet)`,
                url: molde.replace('{id}', '27205'),
                molde,
                origem: 'wayback',
                motivoEsperado: `endereço de título que o site já publicou (${molde.slice(0, 70)})`,
            });
            if (vistos.size >= 3) break;
        }
        if (vistos.size) registrar(`wayback ${dominio}: ${vistos.size} formato(s) de endereço de título`);
    }
    return achados;
}

// ----------------------------------------------------------------- telegram
// A pré-visualização pública de um canal mostra as últimas mensagens. Quem
// publica link de filme/série acaba entregando o domínio do fornecedor.
const DOMINIOS_CONHECIDOS = /(google|gstatic|cloudflare|jsdelivr|unpkg|github|tmdb|themoviedb|telegram|telesco|t\.me|w3\.org|youtube|twitter|facebook|instagram|whatsapp|disqus|doubleclick|linktr|bit\.ly|wa\.me)/i;

async function varrerTelegram(registrar = () => {}) {
    const achados = [];
    for (const canal of CANAIS_TELEGRAM) {
        const html = await textoDe(`https://t.me/s/${canal}`).catch(() => '');
        if (!html || !/tgme_widget_message/.test(html)) continue;
        const dominios = new Set();
        for (const achado of html.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
            const dominio = achado[1].toLowerCase().replace(/^www\./, '');
            if (DOMINIOS_CONHECIDOS.test(dominio)) continue;
            dominios.add(dominio);
        }
        for (const dominio of [...dominios].slice(0, 6)) {
            achados.push({
                nome: `citado no Telegram @${canal}`,
                url: `https://${dominio}/`,
                origem: 'telegram',
                motivoEsperado: `domínio publicado no canal @${canal}`,
            });
        }
        if (dominios.size) registrar(`telegram @${canal}: ${dominios.size} domínio(s) citado(s)`);
    }
    return achados;
}

// ------------------------------------------------------------------ gists
// Gists públicos são usados como "caderninho" de listas. Com o token do GitHub
// a busca funciona e rende domínios que ninguém publicou em site.
async function varrerGists(token = '', registrar = () => {}) {
    if (!token) return [];
    const consultas = ['"m3u8" extension:json', '"filmes" "dublado" extension:json', '"streams" "series" extension:json'];
    const achados = [];
    const dominios = new Set();
    for (const termo of consultas) {
        try {
            const resposta = await comPrazo(axios.get('https://api.github.com/search/code', {
                params: { q: termo, per_page: 5 },
                headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
                timeout: 20000, validateStatus: s => s < 500,
            }));
            const itens = (resposta && resposta.data && resposta.data.items) || [];
            registrar(`github (arquivos) "${termo}": ${itens.length} arquivo(s)`);
            for (const item of itens.slice(0, 3)) {
                const repositorio = item.repository || {};
                const bruto = `https://raw.githubusercontent.com/${repositorio.full_name}/${repositorio.default_branch || 'main'}/${item.path}`;
                const conteudo = await textoDe(bruto).catch(() => '');
                for (const achado of String(conteudo).matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
                    const dominio = achado[1].toLowerCase().replace(/^www\./, '');
                    if (DOMINIOS_CONHECIDOS.test(dominio) || dominios.has(dominio)) continue;
                    dominios.add(dominio);
                }
            }
        } catch { /* tenta a próxima consulta */ }
    }
    for (const dominio of [...dominios].slice(0, 20)) {
        achados.push({
            nome: `listado em arquivo público`,
            url: `https://${dominio}/`,
            origem: 'arquivo público',
            motivoEsperado: `domínio citado em lista pública (${dominio})`,
        });
    }
    if (dominios.size) registrar(`arquivos públicos: ${dominios.size} domínio(s)`);
    return achados;
}

// Todos os vetores de uma vez (cada um é opcional: se cair, os outros seguem).
async function varrerVetores({ dominios = [], token = '', registrar = () => {} } = {}) {
    const [wayback, telegram, gists] = await Promise.all([
        varrerWayback(dominios, registrar).catch(() => []),
        varrerTelegram(registrar).catch(() => []),
        varrerGists(token, registrar).catch(() => []),
    ]);
    return [...wayback, ...telegram, ...gists];
}

module.exports = { varrerVetores, varrerWayback, varrerTelegram, varrerGists, CANAIS_TELEGRAM };
