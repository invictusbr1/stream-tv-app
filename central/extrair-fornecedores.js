'use strict';
// Extrai fornecedores de uma página qualquer que o usuário colou no painel.
//
// A página pode ser um site de filmes, um blog, uma lista de addons… O que
// interessa é o que ela USA por baixo:
//   - addons (endereços que terminam em /manifest.json ou stremio://…);
//   - players embutidos (iframes e endereços /embed/, /player/, /e/ …);
//   - vídeos diretos (.m3u8 / .mp4), só para informar o fornecedor.
//
// Primeiro lê o HTML (rápido). Se a página monta tudo por JavaScript e o HTML
// não mostra nada, abre a página no navegador escondido e anota os pedidos
// que ela faz. Nada aqui entra com conta ou contorna login: página que pede
// cadastro simplesmente não revela fornecedor.

// Hosts que nunca são fornecedor de vídeo (redes sociais, CDNs de biblioteca,
// metadados, fontes de letra, buscadores…).
const LIXO = /(^|\.)(google|googleapis|gstatic|googletagmanager|googlesyndication|doubleclick|cloudflare|cloudflareinsights|jsdelivr|unpkg|cdnjs|bootstrapcdn|fontawesome|jquery|facebook|fbcdn|twitter|x\.com|instagram|tiktok|whatsapp|telegram|t\.me|discord|reddit|github|githubusercontent|wikipedia|tmdb|themoviedb|imdb|gravatar|wp\.com|wordpress|w3|schema|apple|microsoft|bing|yandex|youtube|ytimg|youtu|disqus|histats|hotjar|clarity|sentry|onesignal|addthis|sharethis)\.[a-z.]+$/i;

function hostDe(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

function normalizar(bruto, base) {
    try {
        let s = String(bruto || '').trim().replace(/&amp;/g, '&').replace(/\\\//g, '/');
        if (/^stremio:\/\//i.test(s)) s = s.replace(/^stremio:/i, 'https:');
        if (s.startsWith('//')) s = 'https:' + s;
        const u = new URL(s, base || undefined);
        if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
        u.protocol = 'https:';
        u.hash = '';
        return u.href;
    } catch { return ''; }
}

function baseDeAddon(url) {
    return String(url || '').replace(/\/(manifest\.json|stream\/.*|catalog\/.*|meta\/.*)(\?.*)?$/i, '').replace(/\/+$/, '');
}

function ehAnuncio(host) {
    const { REDES_DE_ANUNCIO } = require('./varredor');
    return (REDES_DE_ANUNCIO || []).some(rede => host.includes(rede));
}

function util(url) {
    const host = hostDe(url);
    return Boolean(host) && !LIXO.test(host) && !ehAnuncio(host);
}

// Lê o HTML (ou o texto de um script) e devolve o que parece fornecedor.
function extrairDoTexto(texto, base) {
    const t = String(texto || '').replace(/\\\//g, '/');
    const addons = new Set(), players = new Set(), videos = new Set(), scripts = new Set();
    for (const m of t.matchAll(/(?:https?:|stremio:)\/\/[^\s"'<>`)]+?\/manifest\.json/gi)) {
        const u = normalizar(m[0], base); if (u && util(u)) addons.add(baseDeAddon(u));
    }
    for (const m of t.matchAll(/<(?:iframe|embed|frame)\b[^>]*?\b(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi)) {
        const u = normalizar(m[1], base); if (u && util(u)) players.add(u);
    }
    for (const m of t.matchAll(/https?:\/\/[^\s"'<>`)\]]+?\/(?:embed|player|e|v|watch|stream|play)\/[^\s"'<>`)\]]+/gi)) {
        const u = normalizar(m[0], base); if (u && util(u) && !/\.(js|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|m3u8|mp4|mkv|webm|ts)(\?|$)/i.test(u) && !/\/stream\/(movie|series)\//i.test(u)) players.add(u);
    }
    for (const m of t.matchAll(/https?:\/\/[^\s"'<>`)\]]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>`)\]]*)?/gi)) {
        const u = normalizar(m[0], base); if (u && util(u)) videos.add(u);
    }
    // Sites brasileiros guardam o player nos botões de "servidor": em atributos
    // data-*, em <option>, em JSON do script ou escondido em base64 (aHR0c…).
    const classificar = bruto => {
        const u = normalizar(bruto, base);
        if (!u || !util(u)) return;
        if (/\/manifest\.json(\?|$)/i.test(u)) addons.add(baseDeAddon(u));
        else if (/\.(m3u8|mp4)(\?|$)/i.test(u)) videos.add(u);
        else if (!/\.(js|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|ts)(\?|$)/i.test(u) && !/\/stream\/(movie|series)\//i.test(u)) players.add(u);
    };
    const decodificar = b64 => { try { const s2 = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); return /^https?:\/\/[\x21-\x7e]+$/.test(s2) ? s2 : ''; } catch { return ''; } };
    for (const m of t.matchAll(/\bdata-(?:url|src|link|player|embed|video|iframe|source|href|play|opcao|server)\s*=\s*["']([^"']{8,})["']/gi)) {
        const v = m[1].trim();
        if (/^(https?:)?\/\//i.test(v)) classificar(v); else { const d = decodificar(v); if (d) classificar(d); }
    }
    for (const m of t.matchAll(/<option\b[^>]*\bvalue\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)) classificar(m[1]);
    for (const m of t.matchAll(/["'](?:file|url|src|embed|embedUrl|iframe|link|player|source)["']\s*:\s*["']((?:https?:)?\\?\/\\?\/[^"']+)["']/gi)) classificar(m[1].replace(/\\\//g, '/'));
    for (const m of t.matchAll(/(aHR0c[A-Za-z0-9+/=_-]{16,})/g)) { const d = decodificar(m[1]); if (d) classificar(d); }
    // Addon montado no código (ex.: kairou: `https://magnetflix.flixbr.online/stream/${tipo}/${id}.json`).
    for (const m of t.matchAll(/(https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w.-]+)*)\/stream\/(?:\$\{|movie\/|series\/)/gi)) {
        const u = normalizar(m[1], base); if (u && util(u)) addons.add(baseDeAddon(u));
    }
    for (const m of t.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        const u = normalizar(m[1], base); if (u) scripts.add(u);
    }
    // Pedaço de endereço de addon (…/stream/${…}) não é player.
    const deAddon = u => /\/stream\/(\$|%24|movie|series)/i.test(u) || [...addons].some(a => u.startsWith(a + '/stream'));
    return { addons: [...addons], players: [...players].filter(u => !deAddon(u)), videos: [...videos], scripts: [...scripts], moldes: moldesDoScript(t) };
}

// MOLDES escritos no código do site. Sites modernos (como o brflix) montam o
// endereço do player no próprio JavaScript:
//   `https://warezcdn.sbs/filme/${imdb}`   ou   'https://x/serie/' + id + '/' + s
// Cada variável vira o marcador que o app entende ({imdb}, {id}, {temporada},
// {episodio}). É a forma mais segura de saber o fornecedor — e para qualquer filme.
function marcadorDe(expr) {
    const e = String(expr || '').replace(/\s+/g, '').toLowerCase();
    const nome = e.split(/[.([]/).pop() || e;
    if (/imdb/.test(e)) return '{imdb}';
    if (/season|temporada/.test(e) || /^(s|t|temp|sea)$/.test(nome)) return '{temporada}';
    if (/episod|epnum|^ep$/.test(e) || /^(e|ep|epi)$/.test(nome)) return '{episodio}';
    if (/tmdb/.test(e) || /^(id|tid|mid|movieid|tvid|serieid)$/.test(nome)) return '{id}';
    return '';
}
function moldesDoScript(texto) {
    const t = String(texto || '');
    const saida = new Map();
    const guardar = modelo => {
        modelo = modelo.replace(/[?#].*$/, m => m.replace(/\$\{[^}]*\}/g, ''));
        if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(modelo) || !/\{(imdb|id)\}/.test(modelo) || /\$\{|\s/.test(modelo)) return;
        if (!util(modelo.replace(/\{[a-z]+\}/g, 'x')) || /image\.tmdb|api\.themoviedb|theintrodb|subtitle|legenda|opensubtitles/i.test(modelo)) return;
        const tipo = /\{temporada\}|\{episodio\}/.test(modelo) ? 'tv' : 'movie';
        saida.set(modelo, { modelo, tipo, chave: modelo.includes('{imdb}') ? 'imdb' : 'id' });
    };
    // Template literal: `https://host/caminho/${var}/...`
    for (const m of t.matchAll(/`(https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^`\s]{0,160})`/gi)) {
        let ok = true;
        const modelo = m[1].replace(/\$\{([^}]{1,60})\}/g, (x, expr) => { const k = marcadorDe(expr); if (!k) ok = false; return k || x; });
        if (ok) guardar(modelo.replace(/^http:/i, 'https:'));
    }
    // Concatenação: 'https://host/filme/' + imdb (+ '/' + s ...)
    for (const m of t.matchAll(/(["'])(https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^"'\s]{0,120})\1((?:\s*\+\s*(?:[A-Za-z_$][\w$.]*|(["'])[^"'\s]{0,20}\5)){1,8})/g)) {
        let modelo = m[2], ok = true;
        for (const parte of m[3].split('+').map(x => x.trim()).filter(Boolean)) {
            if (/^["']/.test(parte)) modelo += parte.slice(1, -1);
            else { const k = marcadorDe(parte); if (!k) { ok = false; break; } modelo += k; }
        }
        if (ok) guardar(modelo.replace(/^http:/i, 'https:'));
    }
    return [...saida.values()].slice(0, 30);
}

// Endereço de player com o número do título vira "molde" (como o app pede
// qualquer filme ou episódio àquele fornecedor). Sem número, não há molde.
function moldeDePlayer(url) {
    const s = String(url || '');
    let m = /^(.*?\/(?:tv|serie|series|episode|episodio)s?\/)(tt\d{6,10}|\d{1,9})([\/-])(\d{1,2})([\/-])(\d{1,4})(.*)$/i.exec(s);
    if (m) return { tipo: 'tv', chave: /^tt/i.test(m[2]) ? 'imdb' : 'id', modelo: `${m[1]}{${/^tt/i.test(m[2]) ? 'imdb' : 'id'}}${m[3]}{temporada}${m[5]}{episodio}${m[7]}` };
    m = /^(.*?\/(?:movie|movies|filme|filmes|film)\/)(tt\d{6,10}|\d{1,9})(.*)$/i.exec(s);
    if (m) return { tipo: 'movie', chave: /^tt/i.test(m[2]) ? 'imdb' : 'id', modelo: `${m[1]}{${/^tt/i.test(m[2]) ? 'imdb' : 'id'}}${m[3]}` };
    m = /^(.*?)(tt\d{6,10})(.*)$/i.exec(s);
    if (m) return { tipo: 'movie', chave: 'imdb', modelo: `${m[1]}{imdb}${m[3]}` };
    return null;
}

// Página do SITE com o número do título no endereço (ex.: pomfy.my/assistir/969681).
// O número pode ser do TMDB ou um código interno — quem decide é a conferência
// de identidade (o título da página precisa bater com o filme pedido).
function moldeDePagina(url) {
    const s = String(url || '').replace(/[?#].*$/, '');
    let m = /^(https:\/\/[^/]+\/(?:assistir|watch|ver|detalhes|titulo|title|play|video|serie|series|tv)\/(?:tv\/|serie\/)?)(\d{2,9})[\/-](\d{1,2})[\/-](\d{1,4})\/?$/i.exec(s);
    if (m) return { tipo: 'tv', chave: 'id', modelo: `${m[1]}{id}/{temporada}/{episodio}`, pagina: true };
    m = /^(https:\/\/[^/]+\/(?:assistir|watch|ver|detalhes|titulo|title|play|video|filme|movie)\/(?:movie\/|filme\/)?)(tt\d{6,10}|\d{2,9})\/?$/i.exec(s);
    if (m) return { tipo: 'movie', chave: /^tt/i.test(m[2]) ? 'imdb' : 'id', modelo: `${m[1]}{${/^tt/i.test(m[2]) ? 'imdb' : 'id'}}`, pagina: true };
    return null;
}

async function extrairFornecedores(link, { buscarTexto, espionar = null, registrar = () => {}, espionarSemMolde = false } = {}) {
    const origem = normalizar(link);
    const saida = { origem: origem || String(link || '').slice(0, 120), addons: [], players: [], videos: [], como: [] };
    if (!origem) { saida.erro = 'endereço inválido'; return saida; }
    // O próprio link já é um addon.
    if (/\/manifest\.json(\?|$)|\/stream\/(movie|series)\//i.test(origem)) {
        saida.addons.push(baseDeAddon(origem)); saida.como.push('link de addon'); return saida;
    }
    const addons = new Set(), players = new Set(), videos = new Set(), moldes = new Map();
    const juntar = r => { r.addons.forEach(x => addons.add(x)); r.players.forEach(x => players.add(x)); r.videos.forEach(x => videos.add(x)); (r.moldes || []).forEach(m => moldes.set(m.modelo, m)); };
    let html = '';
    try { html = await buscarTexto(origem, ''); } catch (e) { saida.aviso = 'a página não abriu direto: ' + String(e && e.message || e).slice(0, 60); }
    // Resposta em JSON com "streams" é um addon, mesmo sem /manifest.json.
    if (/^\s*\{/.test(html) && /"streams"\s*:/.test(html)) { saida.addons.push(baseDeAddon(origem)); saida.como.push('resposta de addon'); return saida; }
    if (html) {
        const r = extrairDoTexto(html, origem); juntar(r); saida.como.push('HTML da página');
        // Scripts do próprio site costumam listar os players (até 4).
        const origemHost = hostDe(origem).replace(/^www\./, '');
        // O código do próprio site é onde ficam os moldes dos players (até 6 arquivos).
        let lidos = 0;
        for (const js of r.scripts.filter(s => hostDe(s).replace(/^www\./, '').endsWith(origemHost)).slice(0, 6)) {
            try { const codigo = await buscarTexto(js, origem); juntar(extrairDoTexto(codigo, js)); lidos++; } catch { /* script fora do ar */ }
        }
        if (lidos) saida.como.push(`código do site (${lidos} arquivo${lidos > 1 ? 's' : ''})`);
    }
    // Página que monta tudo por JavaScript: olha os pedidos no navegador escondido.
    const semNumero = espionarSemMolde && !addons.size && !moldes.size && ![...players].some(p => moldeDePlayer(p));
    if ((semNumero || (!addons.size && !players.size && !videos.size)) && typeof espionar === 'function') {
        registrar('a página não mostra nada no HTML; abrindo no navegador escondido…');
        const r = await espionar(origem, { segundos: 18, registrar }).catch(() => null);
        if (r && !r.semRobo) {
            saida.como.push('navegador escondido');
            const pedidos = [...(r.videos || []), ...(r.molduras || []), ...(r.pedidos || []), ...(r.api || [])].map(p => typeof p === 'string' ? p : (p && p.url) || '');
            for (const a of r.api || []) if (a && a.corpo) juntar(extrairDoTexto(a.corpo, origem));
            juntar(extrairDoTexto(pedidos.join('\n'), origem));
            for (const p of pedidos) {
                const u = normalizar(p, origem);
                if (!u || !util(u)) continue;
                if (/\/manifest\.json(\?|$)|\/stream\/(movie|series)\//i.test(u)) addons.add(baseDeAddon(u));
                else if (/\.(m3u8|mp4)(\?|$)/i.test(u)) videos.add(u);
            }
        } else if (r && r.semRobo) saida.aviso = 'sem navegador no PC para abrir páginas que usam JavaScript';
    }
    saida.addons = [...addons].slice(0, 20);
    saida.players = [...players].slice(0, 20);
    saida.videos = [...videos].slice(0, 20);
    saida.moldes = [...moldes.values()].slice(0, 30);
    if (saida.moldes.length) registrar(`  ${saida.moldes.length} molde(s) de player no código do site: ${[...new Set(saida.moldes.map(m => hostDe(m.modelo.replace(/\{[a-z]+\}/g, 'x'))))].join(', ')}`);
    return saida;
}

module.exports = { moldeDePagina, moldesDoScript, marcadorDe, extrairFornecedores, extrairDoTexto, moldeDePlayer, normalizar, baseDeAddon, hostDe, util };
